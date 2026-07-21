// Admin module routes — RLS is the real gate; BFF adds clear 403s and audit.

const PHONE_RE = /^[6-9][0-9]{9}$/;
const ROLE_CODE_RE = /^[A-Z_]+$/;

export function httpError(status, message, errorCode) {
  const e = new Error(message);
  e.httpStatus = status;
  if (errorCode) e.errorCode = errorCode;
  return e;
}

async function requireAdminPerm(client, perms) {
  const list = Array.isArray(perms) ? perms : [perms];
  const q = await client.query(
    `select bool_or(eworks.has_permission_anywhere(p)) as ok
       from unnest($1::text[]) as p`,
    [list],
  );
  if (!q.rows[0].ok) throw httpError(403, `requires ${list.join(' or ')}`);
}

async function requireCatalogManage(client) {
  const q = await client.query(
    `select eworks.has_permission_anywhere('catalog.manage') as ok`,
  );
  if (!q.rows[0].ok) throw httpError(403, 'requires catalog.manage');
}

async function assertCanGrantRole(client, roleCode, orgUnitId) {
  const pathQ = await client.query(
    `select path::text as path from eworks.org_units where id = $1 and is_active`,
    [orgUnitId],
  );
  if (pathQ.rowCount === 0) throw httpError(404, 'org unit not found');
  const path = pathQ.rows[0].path;

  const manageQ = await client.query(
    `select eworks.has_permission('user.manage', $1::ltree) as ok`,
    [path],
  );
  if (!manageQ.rows[0].ok) {
    throw httpError(403, 'you cannot manage users at this org unit');
  }

  const subsetQ = await client.query(
    `select not exists (
       select 1 from eworks.role_permissions rp
       where rp.role_code = $1
         and not eworks.has_permission(rp.permission_code, $2::ltree)
     ) as ok`,
    [roleCode, path],
  );
  if (!subsetQ.rows[0].ok) {
    throw httpError(403, 'cannot grant a role with permissions you do not hold at this org unit');
  }
}

async function assertLastAdminGuard(client, roleCode, targetUserId, orgUnitId) {
  if (roleCode === 'HEAD_ADMIN') {
    const cQ = await client.query(
      `select count(*)::int as n
         from eworks.user_roles ur
        where ur.role_code = 'HEAD_ADMIN'
          and (ur.expires_at is null or ur.expires_at > now())
          and not (ur.user_id = $1 and ur.org_unit_id = $2::uuid)`,
      [targetUserId, orgUnitId],
    );
    if (cQ.rows[0].n === 0) {
      throw httpError(409, 'cannot remove the last head admin', 'last_head_admin');
    }
  }
  if (roleCode === 'DISTRICT_ADMIN' || roleCode === 'DISTRICT_OFFICER') {
    const ouQ = await client.query(
      `select level::text as level from eworks.org_units where id = $1`,
      [orgUnitId],
    );
    if (ouQ.rows[0]?.level === 'DISTRICT') {
      const cQ = await client.query(
        `select count(*)::int as n
           from eworks.user_roles ur
           join eworks.org_units ou on ou.id = ur.org_unit_id
          where ur.role_code in ('DISTRICT_ADMIN', 'DISTRICT_OFFICER')
            and ou.level = 'DISTRICT'
            and ou.id = $1
            and (ur.expires_at is null or ur.expires_at > now())
            and not (ur.user_id = $2 and ur.org_unit_id = $1)`,
        [orgUnitId, targetUserId],
      );
      if (cQ.rows[0].n === 0) {
        throw httpError(409, 'Ask a head admin to do this.', 'last_district_admin');
      }
    }
  }
}

export function registerAdminRoutes(app, { requireUser, withUserSession }) {
  app.get('/api/admin/users', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const search = String(req.query.q ?? '').trim();
    try {
      const rows = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const q = await client.query(
          `select p.id        as "userId",
                  p.phone,
                  p.full_name as "fullName",
                  p.is_active as "isActive",
                  coalesce(jsonb_agg(jsonb_build_object(
                    'roleCode',  ur.role_code,
                    'roleName',  initcap(replace(ur.role_code, '_', ' ')),
                    'orgUnitId', ou.id,
                    'orgName',   ou.name,
                    'orgLevel',  ou.level,
                    'orgPath',   ou.path::text,
                    'expiresAt', ur.expires_at
                  ) order by ou.path, ur.role_code)
                    filter (where ur.id is not null), '[]'::jsonb) as roles
             from eworks.user_profiles p
             left join eworks.user_roles ur
               on ur.user_id = p.id
              and (ur.expires_at is null or ur.expires_at > now())
             left join eworks.org_units ou on ou.id = ur.org_unit_id
            where ($1 = ''
                   or p.full_name ilike '%' || $1 || '%'
                   or p.phone like $1 || '%')
            group by p.id
            having count(ur.id) filter (where ou.id is not null) > 0
                or $1 <> ''
            order by p.full_name`,
          [search],
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'admin_users_failed', detail: err.message });
    }
  });

  app.post('/api/admin/users', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { fullName, phone, orgUnitId, roleCode, expiresAt } = req.body || {};
    if (!fullName || !String(fullName).trim()) {
      return res.status(400).json({ error: 'invalid_name', detail: 'full name is required' });
    }
    if (!PHONE_RE.test(String(phone ?? ''))) {
      return res.status(400).json({ error: 'invalid_phone', detail: 'phone must be a 10-digit Indian mobile number' });
    }
    if (!orgUnitId || !roleCode) {
      return res.status(400).json({ error: 'org_and_role_required', detail: 'orgUnitId and roleCode are required' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        await assertCanGrantRole(client, roleCode, orgUnitId);
        const pQ = await client.query(
          `insert into eworks.user_profiles (phone, full_name)
           values ($1, $2)
           returning id as "userId", phone, full_name as "fullName"`,
          [String(phone), String(fullName).trim()],
        );
        const created = pQ.rows[0];
        await client.query(
          `insert into eworks.user_roles (user_id, role_code, org_unit_id, granted_by, expires_at)
           values ($1, $2, $3, eworks.current_user_id(), $4)`,
          [created.userId, roleCode, orgUnitId, expiresAt ?? null],
        );
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           select eworks.current_user_id(), 'admin.user_create', 'user_profiles', $1, ou.path,
                  jsonb_build_object('phone', $2::text, 'full_name', $3::text,
                                     'role_code', $4::text, 'org_unit_id', $5::uuid)
             from eworks.org_units ou where ou.id = $5`,
          [created.userId, String(phone), String(fullName).trim(), roleCode, orgUnitId],
        );
        return created;
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'phone_exists', detail: 'a user with this phone already exists' });
      }
      if (err.code === '42501') {
        return res.status(403).json({ error: 'forbidden', detail: err.message });
      }
      if (err.errorCode === 'last_district_admin' || err.errorCode === 'last_head_admin') {
        return res.status(409).json({ error: err.errorCode, detail: err.message });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'user_create_failed', detail: err.message });
    }
  });

  app.get('/api/admin/org-units', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, ['user.manage', 'catalog.manage']);
        const q = await client.query(
          `select id, name, level, path::text as path
             from eworks.org_units
            where is_active
            order by path`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'admin_org_units_failed', detail: err.message });
    }
  });

  app.post('/api/admin/users/:id/roles', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { roleCode, orgUnitId, expiresAt } = req.body || {};
    if (!roleCode || !orgUnitId) {
      return res.status(400).json({ error: 'role_and_org_required', detail: 'roleCode and orgUnitId are required' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        await assertCanGrantRole(client, roleCode, orgUnitId);
        const q = await client.query(
          `insert into eworks.user_roles (user_id, role_code, org_unit_id, granted_by, expires_at)
           values ($1, $2, $3, eworks.current_user_id(), $4)
           returning id, role_code as "roleCode", org_unit_id as "orgUnitId"`,
          [req.params.id, roleCode, orgUnitId, expiresAt ?? null],
        );
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           select eworks.current_user_id(), 'admin.role_grant', 'user_roles', $1, ou.path,
                  jsonb_build_object('user_id', $2::uuid, 'role_code', $3::text, 'org_unit_id', $4::uuid)
             from eworks.org_units ou where ou.id = $4`,
          [q.rows[0].id, req.params.id, roleCode, orgUnitId],
        );
        return q.rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'role_exists', detail: 'this user already holds that role at that org unit' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'role_grant_failed', detail: err.message });
    }
  });

  app.delete('/api/admin/users/:id/roles/:roleCode', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const orgUnitId = String(req.query.orgUnitId ?? '');
    if (!orgUnitId) {
      return res.status(400).json({ error: 'org_required', detail: 'orgUnitId query param is required' });
    }
    try {
      const out = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        await assertLastAdminGuard(client, req.params.roleCode, req.params.id, orgUnitId);
        const dQ = await client.query(
          `delete from eworks.user_roles
            where user_id = $1 and role_code = $2 and org_unit_id = $3
            returning id`,
          [req.params.id, req.params.roleCode, orgUnitId],
        );
        if (dQ.rowCount === 0) throw httpError(404, 'role grant not found');
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           select eworks.current_user_id(), 'admin.role_revoke', 'user_roles', $1, ou.path,
                  jsonb_build_object('user_id', $2::uuid, 'role_code', $3::text, 'org_unit_id', $4::uuid)
             from eworks.org_units ou where ou.id = $4`,
          [dQ.rows[0].id, req.params.id, req.params.roleCode, orgUnitId],
        );
        return { revoked: true };
      });
      res.json(out);
    } catch (err) {
      if (err.errorCode === 'last_head_admin' || err.errorCode === 'last_district_admin') {
        return res.status(409).json({ error: err.errorCode, detail: err.message });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'role_revoke_failed', detail: err.message });
    }
  });

  app.get('/api/admin/roles', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const out = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const rolesQ = await client.query(
          `select r.code, r.name, r.description,
                  coalesce(array_agg(rp.permission_code order by rp.permission_code)
                           filter (where rp.permission_code is not null), '{}') as permissions
             from eworks.roles r
             left join eworks.role_permissions rp on rp.role_code = r.code
            group by r.code, r.name, r.description
            order by r.code`,
        );
        const permsQ = await client.query(
          `select code, description from eworks.permissions order by code`,
        );
        return { roles: rolesQ.rows, permissions: permsQ.rows };
      });
      res.json(out);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'admin_roles_failed', detail: err.message });
    }
  });

  app.post('/api/admin/roles', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { code, name, description, permissions } = req.body || {};
    if (!ROLE_CODE_RE.test(String(code ?? ''))) {
      return res.status(400).json({ error: 'invalid_code', detail: 'role code must be UPPER_SNAKE letters/underscores' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'invalid_name', detail: 'role name is required' });
    }
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'invalid_permissions', detail: 'permissions must be an array of codes' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireCatalogManage(client);
        const rQ = await client.query(
          `insert into eworks.roles (code, name, description)
           values ($1, $2, $3)
           returning code, name, description`,
          [code, String(name).trim(), description ?? null],
        );
        if (permissions.length > 0) {
          await client.query(
            `insert into eworks.role_permissions (role_code, permission_code)
             select $1, p from unnest($2::text[]) as p`,
            [code, permissions],
          );
        }
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'admin.role_create', 'roles', null, null,
                   jsonb_build_object('role_code', $1::text, 'name', $2::text,
                                      'permissions', to_jsonb($3::text[])))`,
          [code, String(name).trim(), permissions],
        );
        return { ...rQ.rows[0], permissions };
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'role_exists', detail: 'a role with this code already exists' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'role_create_failed', detail: err.message });
    }
  });

  app.put('/api/admin/roles/:code/permissions', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { permissions } = req.body || {};
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'invalid_permissions', detail: 'permissions must be an array' });
    }
    try {
      const out = await withUserSession(userId, async (client) => {
        await requireCatalogManage(client);
        const beforeQ = await client.query(
          `select array_agg(permission_code order by permission_code) as perms
             from eworks.role_permissions where role_code = $1`,
          [req.params.code],
        );
        const before = beforeQ.rows[0].perms ?? [];
        await client.query(`delete from eworks.role_permissions where role_code = $1`, [req.params.code]);
        if (permissions.length > 0) {
          await client.query(
            `insert into eworks.role_permissions (role_code, permission_code)
             select $1, p from unnest($2::text[]) as p`,
            [req.params.code, permissions],
          );
        }
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'admin.role_permissions_set', 'roles', null, null,
                   jsonb_build_object('role_code', $1::text, 'before', $2::jsonb, 'after', $3::jsonb))`,
          [req.params.code, JSON.stringify(before), JSON.stringify(permissions)],
        );
        return { code: req.params.code, permissions };
      });
      res.json(out);
    } catch (err) {
      res.status(err.httpStatus ?? 400).json({ error: 'role_permissions_failed', detail: err.message });
    }
  });

  app.get('/api/admin/settings', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const q = await client.query(
          `select key, value, updated_at as "updatedAt"
             from eworks.settings
            where key not like 'nav_visibility:district:%'
               or eworks.has_permission_anywhere('catalog.manage')
            order by key`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'admin_settings_failed', detail: err.message });
    }
  });

  app.put('/api/admin/settings/:key', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const key = req.params.key;
    const { value } = req.body || {};
    if (value === undefined) {
      return res.status(400).json({ error: 'value_required', detail: 'value is required' });
    }
    const isDistrictNav = key.startsWith('nav_visibility:district:');
    const isGlobalNav = key === 'nav_visibility';
    try {
      const row = await withUserSession(userId, async (client) => {
        if (isGlobalNav || (!isDistrictNav && key !== 'nav_visibility')) {
          await requireCatalogManage(client);
        } else if (isDistrictNav) {
          await requireAdminPerm(client, 'user.manage');
          const districtId = key.slice('nav_visibility:district:'.length);
          const scopeQ = await client.query(
            `select eworks.has_permission('user.manage', path) as ok
               from eworks.org_units where id = $1`,
            [districtId],
          );
          if (!scopeQ.rows[0]?.ok) {
            throw httpError(403, 'cannot set tab visibility for this district');
          }
        } else {
          await requireCatalogManage(client);
        }
        const q = await client.query(
          `insert into eworks.settings (key, value, updated_at)
           values ($1, $2::jsonb, now())
           on conflict (key) do update set value = excluded.value, updated_at = now()
           returning key, value, updated_at as "updatedAt"`,
          [key, JSON.stringify(value)],
        );
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'admin.setting_set', 'settings', null, null,
                   jsonb_build_object('key', $1::text))`,
          [key],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(err.httpStatus ?? 400).json({ error: 'setting_set_failed', detail: err.message });
    }
  });

  app.get('/api/admin/grantable-roles', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const orgUnitId = String(req.query.orgUnitId ?? '');
    if (!orgUnitId) {
      return res.status(400).json({ error: 'org_required', detail: 'orgUnitId query param is required' });
    }
    try {
      const rows = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const pathQ = await client.query(
          `select path::text as path from eworks.org_units where id = $1`,
          [orgUnitId],
        );
        if (pathQ.rowCount === 0) throw httpError(404, 'org unit not found');
        const path = pathQ.rows[0].path;
        const q = await client.query(
          `select r.code, r.name
             from eworks.roles r
            where not exists (
              select 1 from eworks.role_permissions rp
              where rp.role_code = r.code
                and not eworks.has_permission(rp.permission_code, $1::ltree)
            )
            order by r.code`,
          [path],
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'grantable_roles_failed', detail: err.message });
    }
  });
}
