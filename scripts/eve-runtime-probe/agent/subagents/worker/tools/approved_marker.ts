import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

export default defineTool({
  description: "Return a harmless UUID marker only after explicit human approval.",
  inputSchema: z.object({ marker: z.uuid() }).strict(),
  approval: always(),
  async execute({ marker }) {
    return { approvedMarker: marker };
  },
});
