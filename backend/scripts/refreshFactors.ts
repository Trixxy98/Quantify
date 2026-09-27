import {prisma} from "../src/lib/prisma";
import {refreshFactors} from "../src/services/factors.service";

async function main() {
    const result = await refreshFactors();
    console.log(result);
    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
