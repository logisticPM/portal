/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // RAP uploads go through the server action as multipart FormData; the default
    // action body limit is 1 MB, too small for RAP PDFs. (Direct-to-S3 presigned
    // upload would remove this limit; server-side upload is simpler for capstone.)
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
