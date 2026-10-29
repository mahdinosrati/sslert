import { z } from "zod";
/** Accept one address or up to 50 addresses; normalize separators without allowing display-name/header syntax. */
export const recipientsSchema = z
  .union([z.string().max(13000), z.array(z.string()).max(50)])
  .transform((value, ctx) => {
    const items = (
      Array.isArray(value) ? value : value.split(/[,;\n\r،]+/)
    ).map((x) => x.trim()).filter(Boolean);
    const unique = [
      ...new Map(items.map((x) => [x.toLowerCase(), x])).values(),
    ];
    if (
      !unique.length ||
      unique.length > 50 ||
      unique.some((x) => !z.string().email().max(254).safeParse(x).success)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter 1–50 valid recipient email addresses",
      });
      return z.NEVER;
    }
    return unique.length === 1 ? unique[0] : unique;
  });
