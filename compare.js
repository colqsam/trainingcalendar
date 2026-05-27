// Loads the static plan and the live activities. The activities function is
// optional: if Strava isn't wired up yet, we still render the plan side.

export async function loadPlan() {
  const res = await fetch('/plan.json');
  if (!res.ok) throw new Error('Could not load plan.json');
  return res.json();
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
