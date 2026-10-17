// Private student files live in UploadThing under keys that start with the school's id. They are never public:
// the only way to open one is a signed link that expires (lib/students/documents.ts decides who may ask for it).
import { UTApi } from 'uploadthing/server';

export async function signStudentFile(key: string, expiresIn: string): Promise<string> {
  const { ufsUrl } = await new UTApi().generateSignedURL(key, { keyType: 'customId', expiresIn: expiresIn as never });
  return ufsUrl;
}
