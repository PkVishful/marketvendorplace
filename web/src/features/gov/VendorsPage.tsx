import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import {
  useGovVendor,
  useGovVendors,
  useRegisterGovVendor,
  useReviewGovVendor,
  useReviewGovVendorDocument,
} from './useGov';
import { VendorKycView } from './vendors/VendorKycView';
import type { RegisterVendorFormData } from './vendors/RegisterVendorPanel';
import type { VendorKycFilter } from './vendors/vendorKycModel';

function docLabelKey(docType: string) {
  return `kyc.doc.${docType}`;
}

export function VendorsPage() {
  const { t } = useTranslation();
  const { data: vendors, isPending, isError, refetch } = useGovVendors('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [filter, setFilter] = useState<VendorKycFilter>('all');
  const { data: detail } = useGovVendor(selectedId ?? '');
  const review = useReviewGovVendor();
  const register = useRegisterGovVendor();
  const docReview = useReviewGovVendorDocument(selectedId ?? '');
  const [message, setMessage] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);
  const [rejectDoc, setRejectDoc] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  async function onReview(decision: 'approve' | 'reject') {
    if (!selectedId) return;
    setMessage(null);
    try {
      const row = await review.mutateAsync({ id: selectedId, decision });
      setMessage({
        tone: 'good',
        text: t(decision === 'approve' ? 'govVendors.approvedOk' : 'govVendors.rejectedOk', {
          name: row.legalName,
        }),
      });
      setSelectedId(null);
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof Error ? err.message : t('govVendors.reviewFailed'),
      });
    }
  }

  async function onDocReview(docType: string, decision: 'approve' | 'reject') {
    if (!selectedId) return;
    if (decision === 'reject' && !rejectReason.trim()) return;
    setMessage(null);
    try {
      await docReview.mutateAsync({
        docType,
        decision,
        reason: decision === 'reject' ? rejectReason.trim() : undefined,
      });
      setRejectDoc(null);
      setRejectReason('');
      setMessage({ tone: 'good', text: t('govVendors.docReviewOk', { doc: t(docLabelKey(docType)) }) });
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof Error ? err.message : t('govVendors.docReviewFailed'),
      });
    }
  }

  async function onRegisterSubmit(data: RegisterVendorFormData) {
    setMessage(null);
    try {
      const row = await register.mutateAsync(data);
      setMessage({
        tone: 'good',
        text: t('govVendors.registerOk', { name: row.legalName }),
      });
      setShowRegister(false);
      setSelectedId(row.id);
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof Error ? err.message : t('govVendors.registerFailed'),
      });
    }
  }

  if (isPending) return <FeedSkeleton />;

  if (isError) {
    return (
      <section className="gov-card border-l-4 border-l-danger p-6 text-center">
        <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
          {t('states.retry')}
        </button>
      </section>
    );
  }

  return (
    <VendorKycView
      vendors={vendors ?? []}
      detail={detail}
      selectedId={selectedId}
      onSelect={(id) => {
        setSelectedId(id);
        setRejectDoc(null);
        setRejectReason('');
      }}
      filter={filter}
      onFilterChange={setFilter}
      message={message}
      reviewPending={review.isPending}
      docReviewPending={docReview.isPending}
      onApprove={() => void onReview('approve')}
      onReject={() => void onReview('reject')}
      onDocApprove={(docType) => void onDocReview(docType, 'approve')}
      rejectDoc={rejectDoc}
      rejectReason={rejectReason}
      onRejectDocStart={setRejectDoc}
      onRejectReasonChange={setRejectReason}
      onRejectDocConfirm={(docType) => void onDocReview(docType, 'reject')}
      onRejectDocCancel={() => {
        setRejectDoc(null);
        setRejectReason('');
      }}
      showRegister={showRegister}
      onOpenRegister={() => {
        setShowRegister(true);
        setSelectedId(null);
      }}
      onCloseRegister={() => setShowRegister(false)}
      onRegisterSubmit={(data) => void onRegisterSubmit(data)}
      registerPending={register.isPending}
    />
  );
}
