const { Client, LocalAuth } = require("whatsapp-web.js");
import type { Message, GroupChat } from "whatsapp-web.js";
const qrcode = require("qrcode-terminal");
const { scheduleJob, RecurrenceRule, Range } = require("node-schedule");

// Bot configuration
const BOT_CONFIG = {
  COMMAND_PREFIX: "!bot",
  START_COMMAND: "!bot start",
  STATUS_COMMAND: "!bot status",
  HELP_COMMAND: "!bot help",
  MONDAY_COMMAND: "!bot monday",
  FRIDAY_COMMAND: "!bot friday",
  DEMO_COMMAND: "!bot demo",
  MONTHLY_COMMAND: "!bot monthly",
  TARGET_GROUP_ID: "", // This will be populated when the bot joins a group
};

// Create a new client instance
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "/home/pptruser/.wwebjs_auth",
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-extensions",
      "--disable-plugins",
      "--disable-default-apps",
      "--disable-hang-monitor",
      "--disable-prompt-on-repost",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-default-browser-check",
      "--safebrowsing-disable-auto-update",
      "--disable-background-networking",
    ],
  },
});

// Scheduler state management
let schedulerActive = false;
const scheduledJobs: Record<string, any> = {};
let botStartTime: Date | null = null;

// Helper function to safely get chat for scheduled tasks
const safelyGetChat = async (chatId: string): Promise<GroupChat | null> => {
  try {
    // Check if client is ready
    if (!client.info || !client.info.wid) {
      console.error("Client is not ready for scheduled task");
      return null;
    }

    const chat = await client.getChatById(chatId);
    if (!chat || !chat.isGroup) {
      console.error("Target group chat not found or not a group");
      return null;
    }

    return chat as GroupChat;
  } catch (error) {
    console.error("Error getting chat for scheduled task:", error);
    return null;
  }
};

// Helper function to retry scheduled task with backoff
const retryScheduledTask = async (
  taskName: string,
  messageText: string,
  maxRetries: number = 3,
  baseDelay: number = 60000 // 1 minute
): Promise<boolean> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`${taskName}: Attempt ${attempt}/${maxRetries}`);

      const groupChat = await safelyGetChat(BOT_CONFIG.TARGET_GROUP_ID);
      if (!groupChat) {
        throw new Error("Unable to get target group chat");
      }

      await groupChat.sendMessage(messageText);
      console.log(
        `${taskName}: Message sent successfully on attempt ${attempt}`
      );
      return true;
    } catch (error) {
      console.error(`${taskName}: Attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        const delay = baseDelay * attempt; // Exponential backoff
        console.log(`${taskName}: Retrying in ${delay / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`${taskName}: All ${maxRetries} attempts failed`);
  return false;
};

// Initialize bot status
const botStatus = {
  isActive: false,
  targetGroup: "",
  targetGroupName: "",
  scheduledTasksCount: 0,
  uptime: function () {
    if (!botStartTime) return "0 minutes";
    const diffMs = Date.now() - botStartTime.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHrs = Math.floor(
      (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${diffDays} days, ${diffHrs} hours, ${diffMins} minutes`;
  },
  nextScheduledTasks: [] as string[],
};

// Helper function to format dates for logging
const formatDate = (date: Date): string => {
  return date.toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    dateStyle: "medium",
    timeStyle: "medium",
  });
};

// Function to check if a date is the last day of the month
const isLastDayOfMonth = (date: Date): boolean => {
  const nextDay = new Date(date);
  nextDay.setDate(date.getDate() + 1);
  return nextDay.getDate() === 1;
};

// Function to determine the week number within the month
const getWeekOfMonth = (date: Date): number => {
  const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const dayOfWeek = firstDayOfMonth.getDay();
  return Math.ceil((date.getDate() + dayOfWeek) / 7);
};

// Function to create, schedule and manage timer tasks
const setupScheduledMessages = async (initialGroupChat: GroupChat) => {
  if (schedulerActive) {
    // Cancel any existing jobs if we're restarting
    Object.values(scheduledJobs).forEach((job) => job.cancel());
    Object.keys(scheduledJobs).forEach((key) => delete scheduledJobs[key]);
  }

  // Store the target group ID from the initial chat
  if (!BOT_CONFIG.TARGET_GROUP_ID) {
    BOT_CONFIG.TARGET_GROUP_ID = initialGroupChat.id._serialized;
    botStatus.targetGroup = initialGroupChat.id._serialized;
    botStatus.targetGroupName = initialGroupChat.name;
    console.log(
      `Set target group to: ${initialGroupChat.name} (${initialGroupChat.id._serialized})`
    );
  }

  try {
    // 1. Monday 9am NZT message
    const mondayRule = new RecurrenceRule();
    mondayRule.dayOfWeek = 1; // Monday
    mondayRule.hour = 9;
    mondayRule.minute = 0;
    mondayRule.tz = "Pacific/Auckland";

    scheduledJobs.monday = scheduleJob("Monday 9am", mondayRule, async () => {
      try {
        const now = new Date();
        console.log(`Executing Monday 9am task at ${formatDate(now)}`);

        await retryScheduledTask(
          "Monday 9am",
          "*Kick off your week with purpose*\n\n👉 What are your main goals this week?\n\nShare below and let's crush this week together! 💪"
        );

        updateNextScheduledTasks();
      } catch (error) {
        console.error("Error in Monday 9am task:", error);
      }
    });

    // 2. Friday 3:30pm NZT message
    const fridayRule = new RecurrenceRule();
    fridayRule.dayOfWeek = 5; // Friday
    fridayRule.hour = 15;
    fridayRule.minute = 30;
    fridayRule.tz = "Pacific/Auckland";

    scheduledJobs.friday = scheduleJob(
      "Friday 3:30pm",
      fridayRule,
      async () => {
        try {
          const now = new Date();
          console.log(`Executing Friday 3:30pm task at ${formatDate(now)}`);

          await retryScheduledTask(
            "Friday 3:30pm",
            "*Wrap up your week with reflection*\n\n👉 How did you do on your goals this week?\n\nShare your insights and let's celebrate our growth! 🎉"
          );

          updateNextScheduledTasks();
        } catch (error) {
          console.error("Error in Friday 3:30pm task:", error);
        }
      }
    );

    // 3. First and third week of every month, on Wednesday at 9am NZT
    scheduledJobs.biweekly = scheduleJob("0 9 * * 3", async () => {
      try {
        const now = new Date(
          new Date().toLocaleString("en-US", { timeZone: "Pacific/Auckland" })
        );
        const weekOfMonth = getWeekOfMonth(now);

        // Only execute on the first and third weeks
        if (weekOfMonth === 1 || weekOfMonth === 3) {
          console.log(
            `Executing bi-weekly task at ${formatDate(
              now
            )} (Week ${weekOfMonth} of the month)`
          );

          await retryScheduledTask(
            "Bi-weekly demo",
            "*Demo day*\n\n👉 Share what you've been cooking up!\n\nThere is no specific format. Could be a short vid, link, screenshot or picture. 🏆"
          );
        }
        updateNextScheduledTasks();
      } catch (error) {
        console.error("Error in bi-weekly task:", error);
      }
    });

    // 4. Last day of every month at 9am NZT
    scheduledJobs.monthEnd = scheduleJob("0 9 * * *", async () => {
      try {
        const now = new Date(
          new Date().toLocaleString("en-US", { timeZone: "Pacific/Auckland" })
        );

        // Only execute on the last day of the month
        if (isLastDayOfMonth(now)) {
          console.log(`Executing month-end task at ${formatDate(now)}`);

          await retryScheduledTask(
            "Monthly celebration",
            "*Monthly Celebration* 🎊\n\nAs we close out the month, take a moment to reflect on your accomplishments!\n\nBe proud of what you've achieved ✨"
          );
        }
        updateNextScheduledTasks();
      } catch (error) {
        console.error("Error in month-end task:", error);
      }
    });

    schedulerActive = true;
    botStatus.isActive = true;
    botStatus.scheduledTasksCount = Object.keys(scheduledJobs).length;
    updateNextScheduledTasks();

    return true;
  } catch (error) {
    console.error("Error setting up scheduled messages:", error);
    return false;
  }
};

// Function to update the next scheduled tasks for diagnostics
const updateNextScheduledTasks = () => {
  botStatus.nextScheduledTasks = [];

  // Get the next invocation time for each job
  Object.entries(scheduledJobs).forEach(([name, job]) => {
    if (job && job.nextInvocation) {
      const nextTime = job.nextInvocation();
      if (nextTime) {
        botStatus.nextScheduledTasks.push(`${name}: ${formatDate(nextTime)}`);
      }
    }
  });

  // Sort by upcoming date
  botStatus.nextScheduledTasks.sort();
};

// Generate QR code for authentication
client.on("qr", (qr: string) => {
  qrcode.generate(qr, { small: true });
  console.log("QR code generated. Scan with WhatsApp mobile app.");
});

// Connection event handlers
client.on("loading_screen", (percent: number) => {
  console.log(`Loading: ${percent}%`);
});

client.on("authenticated", () => {
  console.log("Authentication successful!");
});

client.on("auth_failure", (msg: string) => {
  console.error("Authentication failed:", msg);
});

client.on("ready", () => {
  console.log("Client is ready! WhatsApp bot is now active.");
  botStartTime = new Date();
});

client.on("disconnected", (reason: string) => {
  console.log("Client disconnected:", reason);
  schedulerActive = false;
  botStatus.isActive = false;
});

// Message handler
client.on("message", async (message: Message) => {
  try {
    if (message.from.endsWith("@g.us")) {
      // This is a group message
      const chat = await message.getChat();
      const content = message.body.trim();

      console.log(`Received group message from ${chat.name}: ${content}`);

      // Save this group as our target if not already set
      if (!BOT_CONFIG.TARGET_GROUP_ID) {
        BOT_CONFIG.TARGET_GROUP_ID = message.from;
        botStatus.targetGroup = message.from;
        botStatus.targetGroupName = chat.name;
        console.log(`Set target group to: ${chat.name} (${message.from})`);
      }

      // Handle commands
      if (content === BOT_CONFIG.START_COMMAND) {
        const success = await setupScheduledMessages(chat as GroupChat);
        if (success) {
          await chat.sendMessage(
            "📆 Scheduled message service started! I will now post regular updates according to the schedule."
          );
        } else {
          await chat.sendMessage(
            "❌ Failed to start scheduled message service. Please check server logs."
          );
        }
      } else if (content === BOT_CONFIG.STATUS_COMMAND) {
        // Send diagnostic information
        const status =
          `*Bot Status Report*\n\n` +
          `🤖 Active: ${botStatus.isActive ? "Yes ✅" : "No ❌"}\n` +
          `⏱️ Uptime: ${botStatus.uptime()}\n` +
          `👥 Target Group: ${botStatus.targetGroupName}\n` +
          `📊 Scheduled Tasks: ${botStatus.scheduledTasksCount}\n\n` +
          `*Upcoming Messages:*\n${
            botStatus.nextScheduledTasks.length
              ? botStatus.nextScheduledTasks
                  .map((task) => `- ${task}`)
                  .join("\n")
              : "No upcoming messages scheduled."
          }`;

        await chat.sendMessage(status);
      } else if (content === BOT_CONFIG.HELP_COMMAND) {
        // Display available commands
        const helpText =
          `*Available Commands*\n\n` +
          `📝 *${BOT_CONFIG.START_COMMAND}*\n` +
          `Starts the scheduled messaging service.\n\n` +
          `📊 *${BOT_CONFIG.STATUS_COMMAND}*\n` +
          `Shows the current bot status and upcoming scheduled messages.\n\n` +
          `🛟 *${BOT_CONFIG.HELP_COMMAND}*\n` +
          `Displays this help message.\n\n` +
          `📅 *${BOT_CONFIG.MONDAY_COMMAND}*\n` +
          `Triggers the Monday message manually.\n\n` +
          `📅 *${BOT_CONFIG.FRIDAY_COMMAND}*\n` +
          `Triggers the Friday message manually.\n\n` +
          `📅 *${BOT_CONFIG.DEMO_COMMAND}*\n` +
          `Triggers the biweekly demo day message manually.\n\n` +
          `📅 *${BOT_CONFIG.MONTHLY_COMMAND}*\n` +
          `Triggers the monthly celebration message manually.`;

        await chat.sendMessage(helpText);
      } else if (content === BOT_CONFIG.MONDAY_COMMAND) {
        // Manually trigger Monday message
        console.log(
          `Manually triggering Monday message at ${formatDate(new Date())}`
        );
        await chat.sendMessage(
          "*Kick off your week with purpose*\n\n👉 What are your main goals this week?\n\nShare below and let's crush this week together! 💪"
        );
      } else if (content === BOT_CONFIG.FRIDAY_COMMAND) {
        // Manually trigger Friday message
        console.log(
          `Manually triggering Friday message at ${formatDate(new Date())}`
        );
        await chat.sendMessage(
          "*Wrap up your week with reflection*\n\n👉 How did you do on your goals this week?\n\nShare your insights and let's celebrate our growth! 🎉"
        );
      } else if (content === BOT_CONFIG.DEMO_COMMAND) {
        // Manually trigger biweekly demo day message
        console.log(
          `Manually triggering biweekly demo day message at ${formatDate(
            new Date()
          )}`
        );
        await chat.sendMessage(
          "*Demo day*\n\n👉 Share what you've been cooking up!\n\nThere is no specific format. Could be a short vid, link, screenshot or picture. 🏆"
        );
      } else if (content === BOT_CONFIG.MONTHLY_COMMAND) {
        // Manually trigger monthly celebration message
        console.log(
          `Manually triggering monthly celebration message at ${formatDate(
            new Date()
          )}`
        );
        await chat.sendMessage(
          "*Monthly Celebration* 🎊\n\nAs we close out the month, take a moment to reflect on your accomplishments!\n\nBe proud of what you've achieved ✨"
        );
      }
    }
  } catch (error) {
    console.error("Error handling message:", error);
  }
});

// Error handling
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Initialize the client
console.log("Starting WhatsApp bot...");
client.initialize();
