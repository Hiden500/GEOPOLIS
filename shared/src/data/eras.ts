import { type EraDefinition } from "../types/research/EraDefinition";

export const ERAS: EraDefinition[] = [

    {
        id: "1836",

        name: "Age of Industry",

        startYear: 1836,

        endYear: 1945,

        technologyDomains: [

            "industry",

            "railways",

            "agriculture",

            "medicine",

            "metallurgy",

            "chemistry",

            "naval",

            "artillery",

            "infantry",

            "administration",
        ]
    },

    {
        id: "1946",

        name: "Cold War",

        startYear: 1946,

        endYear: 1999,

        technologyDomains: [

            "nuclear",

            "rocketry",

            "electronics",

            "computing",

            "microelectronics",

            "aviation",

            "radar",

            "biology",

            "armor",

            "naval",

            "infantry",

            "space",

            "materials",

            "industry"
        ]
    },

    {
        id: "2000",

        name: "Information Age",

        startYear: 2000,

        endYear: 2100,

        technologyDomains: [

            "artificialIntelligence",

            "quantumComputing",

            "robotics",

            "cyberwarfare",

            "spaceSystems",

            "biotechnology",

            "hypersonics",

            "electronics",

            "energy",

            "nanotechnology",

            "fusion",

            "materials"
        ]
    }
];