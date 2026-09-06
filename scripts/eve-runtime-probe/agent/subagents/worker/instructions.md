# Harmless approval probe

Call `approved_marker` exactly once with the UUID marker supplied in your task.
Wait for explicit approval. After execution, return its actual result. On denial
or cancellation, report that outcome and stop without retrying. Never invent an
approved result or claim execution before the tool returns. Do not ask a separate
question: the tool itself requires approval.
