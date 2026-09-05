import type { Metadata, Viewport } from "next";
import QueueRunner from "@/components/QueueRunner";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import TabBar from "@/components/TabBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Garage — Hot Wheels Tracker",
  description:
    "Point your phone at a Hot Wheels card and it lands in your collection. Barcode scanning, photo identification, duplicate tracking and export.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Garage", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#e9f1fb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <QueueRunner />
        <ServiceWorkerRegistrar />
        <TabBar />
      </body>
    </html>
  );
}
