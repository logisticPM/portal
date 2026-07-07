/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // RAP uploads go through the server action as multipart FormData; the default
    // action body limit is 1 MB, too small for RAP PDFs. (Direct-to-S3 presigned
    // upload would remove this limit; server-side upload is simpler for capstone.)
    serverActions: { bodySizeLimit: "10mb" },
  },
  async redirects() {
    return [
      { source: "/rap", destination: "/commitments", permanent: true },
      { source: "/rap/explore", destination: "/commitments/explore", permanent: true },
      { source: "/rap/upload", destination: "/extract?tab=upload", permanent: true },
      { source: "/rap/review", destination: "/extract?tab=review", permanent: true },
    ];
  },
};

export default nextConfig;
