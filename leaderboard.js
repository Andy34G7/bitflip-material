async function renderCompressionLeaderboard() {
  const container = document.getElementById("compression-leaderboard");
  if (!container) return;

  try {
    const paths = ["docs/leaderboard.json", "leaderboard.json"];
    let data = null;

    for (const path of paths) {
      try {
        const res = await fetch(path, { cache: "no-store" });
        if (res.ok) {
          data = await res.json();
          break;
        }
      } catch (_) {
        // Try the next path.
      }
    }

    if (!data || !Array.isArray(data.leaderboard)) {
      container.innerHTML = "<p class=\"leaderboard-empty\">No leaderboard data found yet.</p>";
      return;
    }

    const rowsHtml = data.leaderboard.map((row) => {
      const rank = row.rank == null ? "-" : row.rank;
      const ratio = row.avg_ratio == null ? "-" : row.avg_ratio.toFixed(6);
      const status = row.status || "unknown";
      const err = row.error ? row.error : "";
      const label = row.name || "unknown";

      return `
        <tr>
          <td>${rank}</td>
          <td>${label}</td>
          <td>${ratio}</td>
          <td>${status}</td>
          <td>${err}</td>
        </tr>
      `;
    }).join("");

    const generatedAt = data.generated_at ? new Date(data.generated_at).toLocaleString() : "unknown";
    const metric = data.metric || "lower is better";

    container.innerHTML = `
      <p class=\"leaderboard-meta\"><strong>Metric:</strong> ${metric}</p>
      <p class=\"leaderboard-meta\"><strong>Updated:</strong> ${generatedAt}</p>
      <div class=\"leaderboard-table-wrap\">
        <table class=\"leaderboard-table\">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Compressor</th>
              <th>Avg Ratio</th>
              <th>Status</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    container.innerHTML = `<p class=\"leaderboard-empty\">Failed to load leaderboard: ${error}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderCompressionLeaderboard();
});
