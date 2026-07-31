import Link from "next/link";
import type { Car } from "@/lib/types";

export function carSubtitle(car: Car): string {
  return [
    car.series,
    car.seriesNumber,
    car.collectorNumber && `#${car.collectorNumber}`,
    car.year,
    car.color,
    car.toyNumber,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function CarRow({ car }: { car: Car }) {
  const huntClass =
    car.treasureHunt === "sth" ? " is-sth"
    : car.treasureHunt === "th" ? " is-th"
    : "";

  return (
    <Link href={`/car/${car.id}`} className={`car${huntClass}`}>
      {car.thumbnail ?
        // Local data URLs from IndexedDB; next/image would add no value here.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="car-thumb" src={car.thumbnail} alt="" />
      : <div className="car-thumb is-empty" aria-hidden="true">
          ⚙
        </div>
      }
      <div>
        <div className="car-name">
          {car.name}
          {car.treasureHunt === "th" && <span className="badge badge-th">TH</span>}
          {car.treasureHunt === "sth" && <span className="badge badge-sth">$TH</span>}
        </div>
        <div className="car-meta">{carSubtitle(car) || "No details yet"}</div>
      </div>
      {car.quantity > 1 && <div className="qty">×{car.quantity}</div>}
    </Link>
  );
}
