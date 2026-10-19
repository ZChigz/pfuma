import {
  generateReactHelpers,
  generateUploadButton,
  generateUploadDropzone,
} from '@uploadthing/react';
import type { OurFileRouter } from '@/lib/upload-router';

// The upload route lives at app/api/upload (the library's default is /api/uploadthing, which does not exist).
const UPLOAD_URL = '/api/upload';

export const { useUploadThing, uploadFiles } = generateReactHelpers<OurFileRouter>({ url: UPLOAD_URL });
export const UploadButton   = generateUploadButton<OurFileRouter>({ url: UPLOAD_URL });
export const UploadDropzone = generateUploadDropzone<OurFileRouter>({ url: UPLOAD_URL });
