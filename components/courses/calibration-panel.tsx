import { calibrationSentences, type CalibrationSummary } from "@/src/core";

/** The calibration panel (Feature B): sentences + a compact table, or the
 *  not-ready line. All wording comes from the core (calibrationSentences). */
export function CalibrationPanel({ summary }: { summary: CalibrationSummary }) {
	const sentences = calibrationSentences(summary);
	return (
		<section
			data-testid="calibration-panel"
			data-ready={summary.ready ? "true" : "false"}
			className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3"
		>
			<h2 className="text-sm font-medium">How well you know what you know</h2>
			{sentences.map((s) => (
				<p key={s} data-testid="calibration-sentence" className="font-prose text-(length:--lh-prose-size)">
					{s}
				</p>
			))}
			{summary.ready && (
				<table data-testid="calibration-table" className="w-full text-xs text-muted-foreground">
					<thead>
						<tr className="text-left uppercase tracking-wide">
							<th className="py-1 font-medium">Confidence</th>
							<th className="py-1 font-medium">Answers</th>
							<th className="py-1 font-medium">% right</th>
						</tr>
					</thead>
					<tbody>
						{summary.rows.map((r) => (
							<tr key={r.confidence} data-testid="calibration-row">
								<td className="py-0.5">{r.confidence}%</td>
								<td className="py-0.5">{r.answers}</td>
								<td className="py-0.5">{r.accuracy}%</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</section>
	);
}
