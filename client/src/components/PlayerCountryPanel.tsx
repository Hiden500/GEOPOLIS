import { type Country } from "@shared/types/Country";

interface Props {
  country: Country;
}

export function PlayerCountryPanel({
  country
}: Props) {

  return (

    <div>

      <h2>
        {country.name}
      </h2>

      <p>
        Население:
        {" "}
        {country.population.toLocaleString("ru-Ru")}
      </p>

      <p>
        ВВП:
        {" "}
        {Math.round(country.economy.gdp).toLocaleString("ru-Ru")}
      </p>

      <p>
        Казна:
        {" "}
        {country.economy.treasury.toLocaleString("ru-Ru")}
      </p>

      <p>
        Технологии:
        {" "}
        {country.researchedTechnologyIds.toLocaleString("ru-Ru")}
      </p>

      <p>
        Проекты:
        {" "}
        {country.technology.projects.toLocaleString("ru-Ru")}
      </p>

    </div>
  );
}