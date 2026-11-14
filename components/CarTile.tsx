import Link from "next/link";
import CarPhoto from "@/components/CarPhoto";
import type { Car } from "@/lib/types";

/**
 * A garage tile: the car's picture large, the name under it. The picture is
 * the catalogue's shot of that exact release whenever there is one, so the
 * grid shows the cars rather than the photos taken of their cards.
 */
export default function CarTile({ car }: { car: Car }) {
  const facts = [car.year, car.series].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/car/${car.id}`}
      className={`tile${car.wanted ? " is-wanted" : ""}`}
      aria-label={car.wanted ? `${car.name}, on the wishlist` : car.name}
    >
      <CarPhoto car={car} className="tile-photo" width={480} />
      {(car.wanted || car.quantity > 1) && (
        <span className={`qty tile-qty${car.wanted ? " is-want" : ""}`}>
          {car.wanted ? "WANT" : `×${car.quantity}`}
        </span>
      )}
      <span className="tile-name">
        {car.name}
        {car.treasureHunt === "th" && <span className="badge badge-th">TH</span>}
        {car.treasureHunt === "sth" && <span className="badge badge-sth">$TH</span>}
      </span>
      {facts && <span className="tile-meta">{facts}</span>}
    </Link>
  );
}
