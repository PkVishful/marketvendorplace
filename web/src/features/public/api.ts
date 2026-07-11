import { apiClient } from '@/lib/apiClient';
import type { PublicCertificateDTO } from '@/types/domain';

export function fetchPublicCertificate(id: string) {
  return apiClient.get<PublicCertificateDTO>(`/api/public/certificates/${id}`);
}
