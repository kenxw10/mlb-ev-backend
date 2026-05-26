require("dotenv").config();

const {
  runDueOfficialLock,
  runDueOfficialGrade,
  runDueClvCapture
} = require("../services/officialAutomationService");

async function main() {
  const task = process.argv[2];

  if (!task) {
    throw new Error("Task argument is required. Use 'lock', 'grade', or 'clv'.");
  }

  let result = null;

  if (task === "lock") {
    result = await runDueOfficialLock();
  } else if (task === "grade") {
    result = await runDueOfficialGrade();
  } else if (task === "clv") {
    result = await runDueClvCapture();
  } else {
    throw new Error("Invalid task argument. Use 'lock', 'grade', or 'clv'.");
  }

  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
