"use client";

import { useEffect, useState } from "react";
import { CarIcon } from "@/components/icons";
import {
  catalogueNow,
  loadCatalogue,
  releaseForCar,
  releasePhotoUrl,
  type Catalogue,
  type Release,
} from "@/lib/catalogue";
import { PREFS_CHANGED, prefersOwnPhotos } from "@/lib/prefs";
import type { Car } from "@/lib/types";

/**
 * The picture for a car, chosen in this order: a photo the owner took on
 * purpose; the catalogue's photo of that exact release; the scan thumbnail;
 * a silhouette. The catalogue photo is loaded from the wiki and, if it fails
 * (offline, removed), the scan quietly takes its place.
 */
export function useCatalogue(): Catalogue | null {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(catalogueNow);
  useEffect(() => {
    if (catalogue) return;
    let cancelled = false;
    loadCatalogue()
      .then((loaded) => {
        if (!cancelled) setCatalogue(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [catalogue]);
  return catalogue;
}

function usePreferOwn(): boolean {
  const [prefer, setPrefer] = useState(false);
  useEffect(() => {
    const read = () => setPrefer(prefersOwnPhotos());
    read();
    window.addEventListener(PREFS_CHANGED, read);
    return () => window.removeEventListener(PREFS_CHANGED, read);
  }, []);
  return prefer;
}

export type CarPhotoSource = "own" | "catalogue" | "scan" | "none";

export function choosePhoto(
  car: Pick<Car, "thumbnail" | "photoSource" | "toyNumber" | "year">,
  release: Release | undefined,
  preferOwn: boolean,
  width: number,
): { src: string | null; source: CarPhotoSource } {
  if (car.thumbnail && car.photoSource === "own") return { src: car.thumbnail, source: "own" };
  const catalogue = release ? releasePhotoUrl(release, width) : null;
  if (catalogue && !(preferOwn && car.thumbnail)) return { src: catalogue, source: "catalogue" };
  if (car.thumbnail) return { src: car.thumbnail, source: "scan" };
  return { src: null, source: "none" };
}

export default function CarPhoto({
  car,
  release: givenRelease,
  className = "car-thumb",
  width = 320,
  style,
}: {
  car: Pick<Car, "thumbnail" | "photoSource" | "toyNumber" | "year" | "name">;
  /** Pass the release when it is already known (pick lists); otherwise looked up. */
  release?: Release;
  className?: string;
  width?: number;
  style?: React.CSSProperties;
}) {
  const catalogue = useCatalogue();
  const preferOwn = usePreferOwn();
  const [failed, setFailed] = useState<string | null>(null);

  const release = givenRelease ?? (catalogue ? releaseForCar(catalogue, car) : undefined);
  let { src, source } = choosePhoto(car, release, preferOwn, width);
  if (src && failed === src) {
    // The wiki image did not load: fall back to whatever the device has.
    src = car.thumbnail ?? null;
    source = car.thumbnail ? "scan" : "none";
  }

  if (!src) {
    return (
      <div className={`${className} is-empty`} style={style} aria-hidden="true">
        <CarIcon />
      </div>
    );
  }

  return (
    // Wiki images are plain URLs and device photos are data URLs; next/image
    // would help with neither.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt={source === "catalogue" ? `${car.name} (catalogue photo)` : ""}
      data-source={source}
      loading="lazy"
      referrerPolicy="no-referrer"
      style={style}
      onError={() => setFailed(src)}
    />
  );
}
