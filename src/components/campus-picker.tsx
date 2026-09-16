"use client";

import { useEffect, useState } from "react";

export type CampusSelection = {
  universityId: string;
  campusId: string;
  departmentId: string;
  newDepartmentName: string;
};

export const EMPTY_CAMPUS_SELECTION: CampusSelection = {
  universityId: "",
  campusId: "",
  departmentId: "",
  newDepartmentName: "",
};

type University = {
  id: string;
  name: string;
  shortName: string;
  campuses: { id: string; name: string; city: string | null }[];
  faculties: { id: string; name: string; campusId: string | null }[];
  departments: { id: string; name: string; facultyId: string | null }[];
};

const NOT_LISTED = "__not_listed__";

/**
 * University → campus → department.
 *
 * Plain selects rather than a search-as-you-type combobox: this runs on
 * cheap Android phones over campus wifi, and a native select is the one
 * control that is fast, accessible and familiar everywhere.
 *
 * The "my department isn't listed" path matters more than it looks. The
 * seeded list came from public directories that disagreed with each other,
 * so it is known to be incomplete — a student who cannot find their own
 * department and has no way to say so just abandons the form.
 */
export function CampusPicker({
  value,
  onChange,
  labelClass = "mb-1 block text-sm font-medium text-ink",
  fieldClass = "w-full rounded-lg border border-line bg-white px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-purple",
}: {
  value: CampusSelection;
  onChange: (next: CampusSelection) => void;
  labelClass?: string;
  fieldClass?: string;
}) {
  const [universities, setUniversities] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [notListed, setNotListed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/campus")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list: University[] = data.universities ?? [];
        setUniversities(list);
        // One university on the platform today — preselect it rather than
        // making every student pick from a list of one.
        if (list.length === 1 && !value.universityId) {
          onChange({ ...value, universityId: list[0].id });
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uni = universities.find((u) => u.id === value.universityId);
  const facultyName = new Map(uni?.faculties.map((f) => [f.id, f.name]) ?? []);

  // Group departments under their faculty; the ones no public source could
  // attribute go last under a heading that says so rather than pretending.
  const grouped = new Map<string, { id: string; name: string }[]>();
  const unplaced: { id: string; name: string }[] = [];
  for (const d of uni?.departments ?? []) {
    if (!d.facultyId) {
      unplaced.push(d);
      continue;
    }
    const key = facultyName.get(d.facultyId) ?? "Other";
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }

  if (loading) {
    return <p className="text-sm text-ink-3">Loading campuses…</p>;
  }
  if (universities.length === 0) return null;

  return (
    <div className="space-y-4">
      {universities.length > 1 && (
        <div>
          <label className={labelClass} htmlFor="university">
            University
          </label>
          <select
            id="university"
            value={value.universityId}
            onChange={(e) =>
              onChange({
                ...EMPTY_CAMPUS_SELECTION,
                universityId: e.target.value,
              })
            }
            className={fieldClass}
          >
            <option value="">Select your university</option>
            {universities.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {uni && uni.campuses.length > 0 && (
        <div>
          <label className={labelClass} htmlFor="campus">
            Campus
          </label>
          <select
            id="campus"
            value={value.campusId}
            onChange={(e) => onChange({ ...value, campusId: e.target.value })}
            className={fieldClass}
          >
            <option value="">Select your campus</option>
            {uni.campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {uni && (
        <div>
          <label className={labelClass} htmlFor="department">
            Department <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <select
            id="department"
            value={notListed ? NOT_LISTED : value.departmentId}
            onChange={(e) => {
              if (e.target.value === NOT_LISTED) {
                setNotListed(true);
                onChange({ ...value, departmentId: "" });
                return;
              }
              setNotListed(false);
              onChange({
                ...value,
                departmentId: e.target.value,
                newDepartmentName: "",
              });
            }}
            className={fieldClass}
          >
            <option value="">Select your department</option>
            {[...grouped.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([faculty, list]) => (
                <optgroup key={faculty} label={faculty}>
                  {list.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            {unplaced.length > 0 && (
              <optgroup label="Faculty not confirmed">
                {unplaced.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={NOT_LISTED}>My department isn&apos;t listed…</option>
          </select>

          {notListed && (
            <div className="mt-2">
              <input
                id="newDepartment"
                value={value.newDepartmentName}
                onChange={(e) =>
                  onChange({ ...value, newDepartmentName: e.target.value })
                }
                placeholder="Type your department"
                className={fieldClass}
              />
              <p className="mt-1 text-xs text-ink-3">
                We&apos;ll add it for you and check it against the school&apos;s
                list.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
