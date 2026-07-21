const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const BOT_TOKEN = process.env.BOT_TOKEN; //التوكن حق البوت
const bot = new Telegraf(BOT_TOKEN);

const userFiles = {};

// الترحيب
bot.start((ctx) => {
  ctx.reply(
    '👋 مرحباً!\n\n' +
    'أرسل لي الملف (Word أو Excel أو صورة)\n' +
    'وسأرسل لك الصيغ المتاحة للتحويل.'
  );
});

// استقبال الملفات
bot.on('document', async (ctx) => {
  const chatId = ctx.chat.id;
  const doc = ctx.message.document;
  const fileName = doc.file_name;
  const ext = path.extname(fileName).slice(1).toLowerCase();

  const fileLink = await ctx.telegram.getFileLink(doc.file_id);
  const filePath = path.join(__dirname, `temp_${chatId}_${fileName}`);

  const file = fs.createWriteStream(filePath);
  https.get(fileLink.href, (res) => {
    res.pipe(file);
    file.on('finish', () => {
      file.close();

      userFiles[chatId] = { filePath, ext, fileName };

      let formats = [];

      // Word
      if (ext === 'docx') formats = ['pdf'];

      // Excel - كل الصيغ
      if (['xlsx','xls','xlsm','xlsb','csv','txt','xml'].includes(ext)) {
        formats = ['pdf'];
      }

      if (formats.length === 0) {
        return ctx.reply('❌ هذه الصيغة غير مدعومة');
      }

      ctx.reply(
        'اختر الصيغة المطلوبة:',
        {
          reply_markup: {
            inline_keyboard: [
              formats.map(f => ({ text: f.toUpperCase(), callback_data: f }))
            ]
          }
        }
      );
    });
  });
});

// الصور
bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  const photo = ctx.message.photo.pop(); // أعلى جودة
  const fileLink = await ctx.telegram.getFileLink(photo.file_id);

  const fileName = `image_${Date.now()}.jpg`;
  const filePath = path.join(__dirname, `temp_${chatId}_${fileName}`);

  const file = fs.createWriteStream(filePath);
  https.get(fileLink.href, (res) => {
    res.pipe(file);
    file.on('finish', () => {
      file.close();

      userFiles[chatId] = {
        filePath,
        ext: 'jpg',
        fileName
      };

      ctx.reply(
        'اختر الصيغة المطلوبة:',
        {
          reply_markup: {
            inline_keyboard: [[ { text: 'PDF', callback_data: 'pdf' } ]]
          }
        }
      );
    });
  });
});

// التعامل مع اختيار الصيغة
bot.on('callback_query', async (ctx) => {
  const chatId = ctx.chat.id;
  const format = ctx.callbackQuery.data;

  const data = userFiles[chatId];
  if (!data) return ctx.reply('❌ أرسل الملف مرة أخرى');

  const { filePath, ext } = data;
  const outFile = filePath.replace(path.extname(filePath), `.${format}`);

  let command = '';

  // Word → PDF
  if (ext === 'docx' && format === 'pdf') {
    command = `soffice --headless --convert-to pdf "${filePath}" --outdir "${path.dirname(filePath)}"`;
  }

  // Excel → PDF (كل الصيغ)
  if (['xlsx','xls','xlsm','xlsb','csv','txt','xml'].includes(ext) && format === 'pdf') {
    command = `soffice --headless --convert-to pdf "${filePath}" --outdir "${path.dirname(filePath)}"`;
  }

  // Image → PDF
  if (['jpg','jpeg','png'].includes(ext) && format === 'pdf') {
    command = `convert "${filePath}" "${outFile}"`;
  }

  if (!command) return ctx.reply('❌ التحويل غير مدعوم حالياً');

  ctx.reply('⏳ جاري التحويل...');

  exec(command, (err) => {
    if (err) {
      console.error(err);
      return ctx.reply('❌ حدث خطأ أثناء التحويل');
    }

    ctx.telegram.sendDocument(chatId, { source: outFile })
      .then(() => ctx.reply('✅ تم إرسال الملف'))
      .finally(() => delete userFiles[chatId]);
  });
});

bot.launch();
console.log('🤖 البوت شغال...');
