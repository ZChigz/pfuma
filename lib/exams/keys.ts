// Private files of the Examinations module (project evidence and project briefs) live in UploadThing under keys that start with
// the school's id, and are opened only through links that expire. Kept apart so the upload router can use it without the services.
export const EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

export const newEvidenceKey = (schoolId: string, uuid: string) => `mev:${schoolId}:${uuid}`;
export const newBriefKey = (schoolId: string, uuid: string) => `mbf:${schoolId}:${uuid}`;
export const keyBelongs = (key: string, schoolId: string, prefix: 'mev' | 'mbf') => key.startsWith(`${prefix}:${schoolId}:`) && key.length > `${prefix}:${schoolId}:`.length;
