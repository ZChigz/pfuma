import { createRouteHandler } from 'uploadthing/next';
import { fileRouter } from '@/lib/upload-router';

export const { GET, POST } = createRouteHandler({ router: fileRouter });
