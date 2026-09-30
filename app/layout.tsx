import type { Metadata, Viewport } from "next";
import AutoBackup from "@/components/AutoBackup";
import QueueRunner from "@/components/QueueRunner";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import Splash from "@/components/Splash";
import TabBar from "@/components/TabBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "MONEYHOLE — Die-cast collection tracker",
  description:
    "Point your phone at a Hot Wheels card and it lands in your collection. Barcode scanning, photo identification, duplicate tracking and export.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "MONEYHOLE", statusBarStyle: "black" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0d10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Decide about the splash before first paint, so it never pops in
            over an already-drawn page. Installed app, once per launch. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if((matchMedia("(display-mode: standalone)").matches||matchMedia("(display-mode: fullscreen)").matches||navigator.standalone)&&!sessionStorage.getItem("garage:splashed")){document.documentElement.dataset.splash="1";sessionStorage.setItem("garage:splashed","1")}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <Splash />
        {children}
        <QueueRunner />
        <AutoBackup />
        <ServiceWorkerRegistrar />
        <TabBar />
      </body>
    </html>
  );
}
