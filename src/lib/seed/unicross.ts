/**
 * UNICROSS campus data.
 *
 * Assembled from two public sources that did not agree with each other, and
 * neither was the university's own registry. That disagreement is recorded
 * in the data rather than smoothed over:
 *
 * - Campuses and faculties appear in both sources, so they are seeded as
 *   given.
 * - Departments listed under a faculty by the UNICROSS-focused source keep
 *   that faculty.
 * - Programmes that only the national course directory lists are seeded with
 *   NO faculty. They are real programmes, but nothing published said which
 *   faculty runs them, and a plausible guess is exactly the kind of detail
 *   that looks right and is wrong.
 *
 * Everything here is `provisional`. Students correct it on signup; an admin
 * promotes what survives contact with real people to `confirmed`.
 *
 * Sources: unicrossblog.com/faculties-and-departments, myschool.ng course
 * listing for University of Cross River State. Checked September 2026.
 */

export const UNICROSS = {
  name: "University of Cross River State",
  shortName: "UNICROSS",
  slug: "unicross",
  state: "Cross River",
  country: "Nigeria",
};

export const CAMPUSES = [
  { name: "Calabar", slug: "calabar", city: "Calabar" },
  { name: "Ogoja", slug: "ogoja", city: "Ogoja" },
  { name: "Okuku", slug: "okuku", city: "Okuku" },
  { name: "Obubra", slug: "obubra", city: "Obubra" },
];

/** faculty → campus slug, and the departments published under it. */
export const FACULTIES: {
  name: string;
  slug: string;
  campus: string;
  departments: string[];
}[] = [
  {
    name: "Biological Sciences",
    slug: "biological-sciences",
    campus: "calabar",
    departments: [
      "Microbiology",
      "Animal Health and Environmental Biology",
      "Plant Science and Biotechnology",
    ],
  },
  {
    name: "Education",
    slug: "education",
    campus: "calabar",
    departments: [
      "Educational Management",
      "Vocational and Technical Education",
      "Human Kinetics and Health Education",
      "Educational Foundations and Administration",
      "Curriculum and Instructional Technology",
      "Library and Information Science",
      "Guidance and Counselling",
    ],
  },
  {
    name: "Engineering",
    slug: "engineering",
    campus: "calabar",
    departments: [
      "Civil Engineering",
      "Electrical/Electronic Engineering",
      "Mechanical Engineering",
      "Wood Product Engineering",
    ],
  },
  {
    name: "Communication Technology",
    slug: "communication-technology",
    campus: "calabar",
    departments: ["Mass Communication"],
  },
  {
    name: "Environmental Science",
    slug: "environmental-science",
    campus: "calabar",
    departments: [
      "Visual Arts and Technology",
      "Urban and Regional Planning",
      "Estate Management",
    ],
  },
  {
    name: "Architecture",
    slug: "architecture",
    campus: "calabar",
    departments: [
      "Architecture",
      "Architectural Design",
      "Sustainable Architecture and Urban Design",
    ],
  },
  {
    name: "Physical Science",
    slug: "physical-science",
    campus: "calabar",
    departments: [
      "Computer Science",
      "Biochemistry",
      "Chemistry",
      "Physics",
      "Mathematics",
      "Statistics",
    ],
  },
  {
    name: "Management Sciences",
    slug: "management-sciences",
    campus: "ogoja",
    departments: [
      "Accountancy",
      "Business Administration",
      "Marketing",
      "Hospitality and Tourism",
    ],
  },
  {
    name: "Basic Medical Sciences",
    slug: "basic-medical-sciences",
    campus: "okuku",
    departments: [
      "Human Anatomy and Forensic Anthropology",
      "Human Physiology",
      "Medical Biochemistry",
    ],
  },
  {
    name: "Agriculture and Forestry",
    slug: "agriculture-and-forestry",
    campus: "obubra",
    departments: [
      "Agronomy",
      "Agricultural Economics and Extension",
      "Animal Sciences",
      "Fishery and Aquatic Sciences",
      "Forestry and Wildlife Management",
    ],
  },
];

/**
 * Real programmes with no published faculty attribution. Seeded so a student
 * studying one can find it on signup; an admin attaches the faculty once
 * somebody who actually attends UNICROSS says which it is.
 */
export const UNPLACED_DEPARTMENTS = [
  "Economics",
  "Sociology",
  "Psychology",
  "Peace and Conflict Resolution",
  "Entrepreneurship",
  "Journalism and Media Studies",
  "Broadcasting",
  "Software Engineering",
  "Information Systems",
  "Industrial Chemistry",
  "Business Education",
  "Agricultural Science and Education",
  "Mathematics with Statistics",
];
