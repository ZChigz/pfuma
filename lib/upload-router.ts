// UploadThing file routes. Kept out of the route file so tests can read them
// (Next.js only allows HTTP-method exports from a route.ts).
import { createUploadthing, type FileRouter } from 'uploadthing/next';
import { UploadThingError, UTFiles } from 'uploadthing/server';
import { auth } from '@/lib/auth';
import { requirePermission } from '@/lib/access';
import { POP_ALLOWED_TYPES, POP_MAX_BYTES, newProofKey } from '@/lib/proof-of-payment';

const f = createUploadthing();

const SETTINGS_IMAGE_TYPES = ['image/png', 'image/jpeg'];
const SETTINGS_IMAGE_MAX_BYTES = 1024 * 1024;

async function settingsImageGate(files: readonly { type: string; size: number }[]) {
  try {
    const user = await requirePermission('system.settings.update');
    for (const file of files) {
      if (!SETTINGS_IMAGE_TYPES.includes(file.type)) throw new UploadThingError('Use a PNG or JPG image');
      if (file.size > SETTINGS_IMAGE_MAX_BYTES) throw new UploadThingError('The image must be 1 MB or smaller');
    }
    return { userId: user.id };
  } catch (e) {
    if (e instanceof UploadThingError) throw e;
    throw new UploadThingError('You cannot change the school settings');
  }
}

export const fileRouter = {
  // Proof of payment: images and PDF only, at most 5 MB, stored privately.
  // UploadThing only offers power-of-two size limits (4MB, 8MB), so the 5 MB cap
  // is enforced in the middleware below; the file type list is enforced by the
  // route config. Files get a custom id that starts with the school id, which is
  // how the payment API checks that a key belongs to the caller's school. They
  // are read back only through short-lived signed URLs (/api/accounting/payments/[id]/proof).
  proofOfPayment: f({
    'image/jpeg':      { maxFileSize: '8MB', maxFileCount: 1, acl: 'private' },
    'image/png':       { maxFileSize: '8MB', maxFileCount: 1, acl: 'private' },
    'image/webp':      { maxFileSize: '8MB', maxFileCount: 1, acl: 'private' },
    'application/pdf': { maxFileSize: '8MB', maxFileCount: 1, acl: 'private' },
  })
    .middleware(async ({ files }) => {
      const session = await auth();
      if (!session?.user) throw new UploadThingError('Unauthorized');
      for (const file of files) {
        if (!(POP_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
          throw new UploadThingError('Only JPG, PNG, WebP or PDF files are allowed');
        }
        if (file.size > POP_MAX_BYTES) throw new UploadThingError('The file must be 5 MB or smaller');
      }
      const schoolId = session.user.schoolId;
      return {
        userId: session.user.id,
        schoolId,
        [UTFiles]: files.map((file) => ({ ...file, customId: newProofKey(schoolId) })),
      };
    })
    .onUploadComplete(({ file }) => ({ key: file.customId ?? file.key })),

  assetImage: f({ image: { maxFileSize: '8MB', maxFileCount: 1 } })
    .middleware(async () => {
      const session = await auth();
      if (!session?.user) throw new Error('Unauthorized');
      return { userId: session.user.id };
    })
    .onUploadComplete(() => {}),

  studentPhoto: f({ image: { maxFileSize: '4MB', maxFileCount: 1 } })
    .middleware(async () => {
      const session = await auth();
      if (!session?.user) throw new Error('Unauthorized');
      return { userId: session.user.id };
    })
    .onUploadComplete(() => {}),

  bookCover: f({ image: { maxFileSize: '4MB', maxFileCount: 1 } })
    .middleware(async () => {
      const session = await auth();
      if (!session?.user) throw new Error('Unauthorized');
      return { userId: session.user.id };
    })
    .onUploadComplete(() => {}),

  // School logo and head's signature (Settings → School profile): PNG or JPG, at most 1 MB,
  // and only people who may change settings. The size and type are checked here as well as in
  // the route config, because a client can lie about both.
  schoolLogo: f({ 'image/png': { maxFileSize: '1MB', maxFileCount: 1 }, 'image/jpeg': { maxFileSize: '1MB', maxFileCount: 1 } })
    .middleware(async ({ files }) => settingsImageGate(files))
    .onUploadComplete(() => {}),

  headSignature: f({ 'image/png': { maxFileSize: '1MB', maxFileCount: 1 }, 'image/jpeg': { maxFileSize: '1MB', maxFileCount: 1 } })
    .middleware(async ({ files }) => settingsImageGate(files))
    .onUploadComplete(() => {}),
} satisfies FileRouter;

export type OurFileRouter = typeof fileRouter;

