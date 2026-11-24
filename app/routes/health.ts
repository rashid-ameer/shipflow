import prisma from "../db.server";

export async function loader() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ app: "shipflow", status: "ok" }, { headers });
  } catch {
    return Response.json(
      { app: "shipflow", status: "unavailable" },
      { status: 503, headers },
    );
  }
}
