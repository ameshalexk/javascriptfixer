const fs = require("fs");
const path = require("path");
const util = require("util");
const child_process = require("child_process");
const exec = util.promisify(child_process.exec);
const openai = require("openai");
const diff = require("diff");

openai.apiKey = process.env.OPENAI_API_KEY;

function colored(text, colorCode) {
  return `${colorCode}${text}\x1b[0m`;
}

function colorizeDiff(diff) {
  const colorMap = {
    "+": "\x1b[32m",
    "-": "\x1b[31m",
    "@": "\x1b[34m",
  };

  return diff
    .split("\n")
    .map((line) => colored(line, colorMap[line[0]] || "\x1b[37m"))
    .join("\n");
}

async function runCode(filePath) {
  try {
    const { stdout, stderr } = await exec(`python3 ${filePath}`);
    return stdout + stderr;
  } catch (error) {
    return error.stdout + error.stderr;
  }
}

async function sendCode(filePath, intent) {
  const code = fs.readFileSync(filePath, "utf-8");
  const output = await runCode(filePath);

  const prompt = `I have a Python program with errors, and I would like you to \
            help me fix the issues in the code.
    The original code of the program run (${filePath}) and the output, including any error messages and stack \
            traces, are provided below.
    
    Please return a JSON object containing the suggested changes in a format \
            similar to the git diff system, showing whether a line is added,
            removed, or edited for each file.
    ${intent ? "Intent: " + intent : ""}
    Original Code:
    ${code}
    Output:
    ${output}
    For example, the JSON output should look like:
    {
    "intent": "This should be what you think the program SHOULD do.",
    "explanation": "Explanation of what went wrong and the changes being made",
    "files": [
        {
            "file_name": "file_name.py",
            "changes": [
                {
                "action": "edit",
                "line_number": 2,
                "original_line": "print(hello world')",
                "new_line": "print('hello world')",
                }
            ]
        },
    ]
    
    }
    In the 'action' field, use "add" for adding a line,
    "remove" for removing a line, and "edit" for editing a line.
    Please provide the suggested changes in this format.
    DO NOT DEVIATE FROM THE FORMAT IT MUST BE ABLE TO BE PARSED BY ME! 
    You will be penalized if you do.`;

  const response = await openai.ChatCompletion.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant that is great at \
                        fixing code and not breaking it.",
      },
      { role: "user", content: prompt },
    ],
  });

  return response.choices[0].message.content;
}

function editCode(filePath, fix) {
  const filesChanged = JSON.parse(fix).files;
  for (const f of filesChanged) {
    const file = f.file_name;
    const changes = f.changes;
    const lines = fs.readFileSync(file, "utf-8").split("\n");

    for (const change of changes) {
      const action = change.action;
      const lineNumber = change.line_number - 1;
      const originalLine = change.original_line;
      const newLine = change.new_line;
    
      if (action === "edit" && lines[lineNumber].trim() === originalLine.trim()) {
        const indent = lines[lineNumber].length - lines[lineNumber].trimStart().length;
        lines[lineNumber] = " ".repeat(indent) + newLine;
      } else if (action === "remove" && lines[lineNumber].trim() === originalLine.trim()) {
        lines.splice(lineNumber, 1);
      } else if (action === "add") {
        lines.splice(lineNumber, 0, newLine);
      }
    }
    
    fs.writeFileSync(file, lines.join("\n"));
  }
  return filesChanged.map((f) => f.file_name);
}

async function main(filePath, intent) {
  const originalCode = fs.readFileSync(filePath, "utf-8");
  console.log('Original Code:\n${originalCode}\n');
  
  while (true) {
  const output = await runCode(filePath);
  if (output.includes("Traceback")) {
  console.log('Output:\n${output}\n');
  console.log("Fixing code...\n");
  const fix = await sendCode(filePath, intent);
  console.log('Fix:\n${fix}\n');
  const filesChanged = editCode(filePath, fix);
  for (const codeFile of filesChanged) {
    const originalCodeFile = fs.readFileSync(codeFile, "utf-8");
    const newCodeFile = fs.readFileSync(codeFile, "utf-8");
    const fileDiff = diff.createPatch("file", originalCodeFile, newCodeFile);
    const coloredDiff = colorizeDiff(fileDiff);
    console.log(`\x1b[33m${codeFile}\x1b[0m`);
    console.log(coloredDiff);
  }
} else {
  console.log(`Output:\n${output}\n`);
  console.log("Code is syntax error-free!");
  break;
}
}
}

const args = process.argv.slice(2);
if (args.length > 1) {
main(args[0], args.slice(1).join(" "));
} else {
main(args[0]);
}