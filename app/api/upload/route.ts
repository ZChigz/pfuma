import { createUploadthing, type FileRouter } from 'uploadthing/next';
import { createRouteHandler } from 'uploadthing/next';
import { auth } from '@/lib/auth';

const f = createUploadthing();

const fileRouter = {
  proofOfPayment: f({
    image: { maxFileSize: '4MB', maxFileCount: 1 },
    pdf:   { maxFileSize: '4MB', maxFileCount: 1 },
  })
    .middleware(async () => {
      const session = await auth();
      if (!session?.user) throw new Error('Unauthorized');
      return { userId: session.user.id, schoolId: session.user.schoolId };
    })
    .onUploadComplete(() => {}),

  assetImage: f({ image: { maxFileSize: '8MB', maxFileCount: 1 } })
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
} satisfies FileRouter;

export type OurFileRouter = typeof fileRouter;

export const { GET, POST } = createRouteHandler({ router: fileRouter });
