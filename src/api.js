// Loads the static plan and the live activities. The activities function is
// optional: if Strava isn't wired up yet, we still render the plan side.

export async function loadPlan() {
  const res = await fetch('/plan.json');
  if (!res.ok) throw new Error('Could not load plan.json');
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('plan.json is not a valid plan array — the file may have been overwritten with the wrong contents.');
  return data;
}

export async function loadProjectionConfig() {
  try {
    const res = await fetch('/projection.json');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function loadRaceConfig() {
  try {
    const res = await fetch('/race.json');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function loadActivities() {
  try {
    const res = await fetch('/.netlify/functions/activities');
    const data = await res.json();
    if (!res.ok) return { activities: [], error: data };
    return { activities: data.activities || [], fetchedAt: data.fetched_at };
  } catch (err) {
    return { activities: [], error: { message: String(err) } };
  }
}

export async function loadDecoupling() {
  try {
    const res = await fetch('/.netlify/functions/decoupling');
    const data = await res.json();
    if (!res.ok) return { runs: [], error: data };
    return { runs: data.runs || [] };
  } catch (err) {
    return { runs: [], error: { message: String(err) } };
  }
}
