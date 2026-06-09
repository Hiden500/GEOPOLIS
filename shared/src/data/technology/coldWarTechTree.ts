import { TechnologyDefinition } from "../../types/research/TechnologyDefinition";

export const coldWarTechTree:
    TechnologyDefinition[] = [

        {
            id: "nuclear_0",

            name: "Nuclear Power",

            domain: "nuclear",

            level: 0,

            prerequisites: [],

            description:
                "Theory of nuclear power"
        },

        {
            id: "nuclear_1",

            name: "Nuclear Research",

            domain: "nuclear",

            level: 1,

            prerequisites: [
                "nuclear_0"
            ],

            description:
                "Early reactor technology"
        },

        {
            id: "nuclear_2",

            name: "Atomic Bomb",

            domain: "nuclear",

            level: 2,

            prerequisites: [
                "nuclear_1"
            ],

            description:
                "Operational atomic weapon"
        },

        {
            id: "nuclear_3",

            name: "Hydrogen Bomb",

            domain: "nuclear",

            level: 3,

            prerequisites: [
                "nuclear_2"
            ],

            description:
                "Thermonuclear weapons"
        },

        {
            id: "rocketry_0",

            name: "Rocketry",

            domain: "rocketry",

            level: 0,

            prerequisites: [],

            description:
                "Theory of rocketry"
        },

        {
            id: "rocketry_1",

            name: "Ballistic Missiles",

            domain: "rocketry",

            level: 1,

            prerequisites: [
                "rocketry_0"
            ],

            description:
                "V-2 derived systems"
        },

        {
            id: "rocketry_2",

            name: "Intermediate Range Missiles",

            domain: "rocketry",

            level: 2,

            prerequisites: [
                "rocketry_1"
            ],

            description:
                "IRBM technology"
        },

        {
            id: "rocketry_3",

            name: "ICBM",

            domain: "rocketry",

            level: 3,

            prerequisites: [
                "rocketry_2",
                "electronics_2"
            ],

            description:
                "Intercontinental missiles"
        },
    ];