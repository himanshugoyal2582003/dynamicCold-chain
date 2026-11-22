import { apiFetch } from './auth';

export interface AvailableOwner {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

/** Fetch the complete active-owner list through the authenticated admin API. */
export async function getAvailableOwners(): Promise<AvailableOwner[]> {
  const response = await apiFetch('/api/admin/owners?active=true');
  const rows = Array.isArray(response) ? response : response?.owners;
  if (!Array.isArray(rows)) throw new Error('Owner service returned an invalid response.');

  return rows.filter((owner: any) =>
    owner && typeof owner.id === 'string' && owner.id.length > 0 &&
    typeof owner.name === 'string' && typeof owner.email === 'string' && owner.active === true
  ).map((owner: any) => ({
    id: owner.id,
    name: owner.name,
    email: owner.email,
    active: owner.active,
  }));
}
