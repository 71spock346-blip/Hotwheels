import Link from "next/link";
import CarPhoto from "@/components/CarPhoto";
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
  const wantedClass = car.wanted ? " is-wanted" : "";

  return (
    <Link href={`/car/${car.id}`} className={`car${huntClass}${wantedClass}`}>
      <CarPhoto car={car} />
      <div>
        <div className="car-name">
          {car.name}
          {car.treasureHunt === "th" && <span className="badge badge-th">TH</span>}
          {car.treasureHunt === "sth" && <span className="badge badge-sth">$TH</span>}
        </div>
        <div className="car-meta">{carSubtitle(car) || "No details yet"}</div>
      </div>
      {car.wanted ?
        <div className="qty is-want">WANT</div>
      : car.quantity > 1 ?
        <div className="qty">×{car.quantity}</div>
      : null}
    </Link>
  );
}
