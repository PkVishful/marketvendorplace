import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEngineer,
  addExperience,
  addMachinery,
  deleteEligibilityRow,
  eligibilityKeys,
  fetchEligibility,
  type EligibilityKind,
} from './api';

export function useEligibility() {
  return useQuery({
    queryKey: eligibilityKeys.all,
    queryFn: fetchEligibility,
  });
}

export function useAddExperience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addExperience,
    onSuccess: () => void qc.invalidateQueries({ queryKey: eligibilityKeys.all }),
  });
}

export function useAddMachinery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addMachinery,
    onSuccess: () => void qc.invalidateQueries({ queryKey: eligibilityKeys.all }),
  });
}

export function useAddEngineer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addEngineer,
    onSuccess: () => void qc.invalidateQueries({ queryKey: eligibilityKeys.all }),
  });
}

export function useDeleteEligibilityRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id }: { kind: EligibilityKind; id: string }) => deleteEligibilityRow(kind, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: eligibilityKeys.all }),
  });
}
