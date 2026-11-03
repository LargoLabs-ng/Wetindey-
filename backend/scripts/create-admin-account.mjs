import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import bcrypt from "bcryptjs";

function readLocalEnvironment() {
  const env = {};
  for (const line of readFileSync("frontend/.env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator > 0) {
      env[trimmed.slice(0, separator).trim()] = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

function ask(question) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Run this command in an interactive IDE terminal.");
  }

  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    let value = "";
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    const finish = (error) => {
      input.removeListener("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("Password entry cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0008" || character === "\u007f") {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };

    input.on("data", onData);
  });
}

async function main() {
  let env;
  try {
    env = readLocalEnvironment();
  } catch {
    throw new Error("Could not read frontend/.env.local.");
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing from frontend/.env.local.");
  }

  const adminEmails = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) {
    throw new Error("Add the authorized email to ADMIN_EMAILS first.");
  }

  const email = (await ask("Authorized admin email: ")).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (!adminEmails.includes(email)) {
    throw new Error("That email is not listed in ADMIN_EMAILS.");
  }

  const name = await ask("Admin name: ");
  if (!name || name.length > 200) {
    throw new Error("Enter a name between 1 and 200 characters.");
  }
  const password = await askHidden("Admin password (minimum 12 characters): ");
  if (password.length < 12) {
    throw new Error("Use a password with at least 12 characters.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const [firstName, ...lastParts] = name.split(/\s+/);
  const lastName = lastParts.join(" ") || null;

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ssl: "require",
  });
  try {
    await sql`
      INSERT INTO users (first_name, last_name, name, email, password_hash)
      VALUES (${firstName}, ${lastName}, ${name}, ${email}, ${passwordHash})
      ON CONFLICT (email) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        updated_at = now()
    `;
  } finally {
    await sql.end();
  }

  console.log(`Admin login provisioned for ${email}.`);
}

main().catch((error) => {
  console.error(`Admin account setup failed: ${error.message}`);
  process.exitCode = 1;
});
