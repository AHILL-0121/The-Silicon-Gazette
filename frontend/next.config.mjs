/** @type {import('next').NextConfig} */
const nextConfig = {
	// The app never uses next/image. Disabling the optimizer removes the
	// /_next/image attack surface (several Next.js advisories target it).
	images: {
		unoptimized: true
	},
	poweredByHeader: false,
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
				]
			},
			{
				source: "/analytics",
				headers: [
					{ key: "Cache-Control", value: "no-store" },
					{ key: "X-Robots-Tag", value: "noindex, nofollow" }
				]
			},
			{
				source: "/api/analytics/:path*",
				headers: [{ key: "Cache-Control", value: "no-store" }]
			},
			{
				source: "/api/track",
				headers: [{ key: "Cache-Control", value: "no-store" }]
			}
		];
	}
};

export default nextConfig;
