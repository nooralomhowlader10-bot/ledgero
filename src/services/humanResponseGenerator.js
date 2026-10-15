/**
 * @module humanResponseGenerator
 * @description Response humanization engine for Dr. NAM AI voice assistant.
 * Generates natural, context-aware spoken responses in Bengali, Hindi, and English.
 */

const lastUsedVariant = new Map();

const RESPONSE_VARIANTS = {
  expense: {
    bn: [
      'ঠিক আছে, {amount} টাকা খরচ লিখে রাখলাম।',
      'জি, {amount} টাকা খরচ হিসেবে এন্ট্রি করে দিলাম।',
      'হয়ে গেছে, {amount} টাকা খরচ যোগ হলো।',
      'ওকে, {note} বাবদ {amount} টাকা খরচ রেকর্ড করলাম।',
    ],
    hi: [
      'ठीक है, {amount} रुपये का खर्चा लिख दिया।',
      'जी, {amount} रुपये खर्चे में जोड़ दिया।',
      'हो गया, {amount} रुपये का खर्चा दर्ज।',
    ],
    en: [
      'Done! Recorded {amount} taka as expense.',
      'Got it, {amount} taka expense logged.',
      'Noted! {amount} taka added to expenses.',
    ]
  },
  sale: {
    bn: [
      'মাশাআল্লাহ, {amount} টাকার বিক্রি লিখে রাখলাম।',
      'জি, {amount} টাকার নগদ বিক্রি এন্ট্রি হলো।',
      'ঠিক আছে, আপনার {amount} টাকার সেল যোগ করে দিয়েছি।',
      'খুব ভালো, {amount} টাকার বিক্রি হিসাবের খাতায় তুলে নিলাম।',
    ],
    hi: [
      'बढ़िया, {amount} रुपये की बिक्री लिख दी।',
      'जी, {amount} रुपये की नकद बिक्री दर्ज हो गई।',
      'ठीक है, {amount} रुपये की सेल जोड़ दी है।',
    ],
    en: [
      'Great, logged {amount} taka in sales.',
      'Got it, cash sale of {amount} taka recorded.',
      'Done, {amount} taka added to sales.',
    ]
  },
  stock_sell: {
    bn: [
      '{quantity} {unit} {product} বিক্রি হিসেবে লিখে রাখলাম, দাম {amount} টাকা।',
      'জি, {product} বিক্রি হলো {amount} টাকায়, স্টক থেকে কমিয়ে দিয়েছি।',
      'ঠিক আছে, {quantity} {unit} {product} বিক্রির হিসাব তুলে নিলাম।',
    ],
    hi: [
      '{quantity} {unit} {product} की बिक्री {amount} रुपये में दर्ज कर ली।',
      'जी, {product} स्टॉक से कम कर दिया है।',
      'ठीक है, {product} की बिक्री लिख दी।',
    ],
    en: [
      'Recorded sale of {quantity} {unit} {product} for {amount} taka.',
      'Got it, {product} inventory updated after sale.',
      'Done, logged {product} sale of {amount} taka.',
    ]
  },
  stock_restock: {
    bn: [
      '{quantity} {unit} {product} নতুন করে স্টকে যোগ করে নিলাম।',
      'জি, {amount} টাকা দিয়ে {product} কেনা হলো, স্টকে তুলে দিয়েছি।',
      'ঠিক আছে, দোকানে নতুন {product} এসেছে, আমি লিখে রাখলাম।',
    ],
    hi: [
      '{quantity} {unit} {product} स्टॉक में जोड़ दिया है।',
      'जी, {product} की खरीदारी {amount} रुपये में दर्ज कर ली।',
      'ठीक है, नया {product} स्टॉक में आ गया।',
    ],
    en: [
      'Added {quantity} {unit} {product} to stock.',
      'Got it, logged {product} purchase for {amount} taka.',
      'Done, {product} inventory updated.',
    ]
  },
  due_give: {
    bn: [
      '{contact} ভাইয়ের নামে {amount} টাকা বাকি লিখে রাখলাম।',
      'জি, {contact} কে {amount} টাকার বাকি দেওয়া হলো, হিসাবে তুলে নিয়েছি।',
      'ঠিক আছে, {amount} টাকা বকেয়া হিসেবে এন্ট্রি করে দিলাম।',
    ],
    hi: [
      '{contact} के नाम पर {amount} रुपये का उधार लिख दिया।',
      'जी, {contact} को {amount} रुपये उधार दिए।',
      'ठीक है, {amount} रुपये का उधार दर्ज कर लिया।',
    ],
    en: [
      'Recorded {amount} taka due for {contact}.',
      'Got it, logged {amount} taka credit given to {contact}.',
      'Done, {contact} now owes {amount} taka.',
    ]
  },
  due_collect: {
    bn: [
      'আলহামদুলিল্লাহ, {contact} এর কাছ থেকে {amount} টাকা বাকি আদায় হলো।',
      'জি, {amount} টাকা বকেয়া জমা হলো, আমি হিসাব মিলিয়ে দিয়েছি।',
      'ঠিক আছে, {contact} এর খাতা থেকে {amount} টাকা কমিয়ে দিলাম।',
    ],
    hi: [
      '{contact} से {amount} रुपये उधार वापस मिल गए।',
      'जी, {amount} रुपये की वसूली दर्ज कर ली।',
      'ठीक है, {contact} का उधार {amount} रुपये कम कर दिया।',
    ],
    en: [
      'Collected {amount} taka due from {contact}.',
      'Got it, {amount} taka due collection logged.',
      'Done, {contact} balance updated by {amount} taka.',
    ]
  },
  product_add: {
    bn: [
      'নতুন পণ্য {product} আমাদের তালিকায় যোগ করে নিয়েছি।',
      'জি, {product} এর নাম সেভ করে রাখলাম।',
      'ঠিক আছে, এখন থেকে {product} এর হিসাব রাখা যাবে।',
    ],
    hi: [
      'नया प्रोडक्ट {product} लिस्ट में जोड़ दिया।',
      'जी, {product} का नाम सेव कर लिया है।',
      'ठीक है, नया आइटम {product} दर्ज हो गया।',
    ],
    en: [
      'Added new product {product} to the list.',
      'Got it, saved {product} in items.',
      'Done, {product} is now available.',
    ]
  },
  contact_add: {
    bn: [
      '{name} এর নাম আর নাম্বার সেভ করে রাখলাম।',
      'জি, নতুন কাস্টমার {name} কে তালিকায় যোগ করে নিয়েছি।',
      'ঠিক আছে, {name} এর হিসাব এখন থেকে আলাদা রাখা যাবে।',
    ],
    hi: [
      '{name} का नाम और नंबर सेव कर लिया।',
      'जी, नए ग्राहक {name} को जोड़ दिया है।',
      'ठीक है, {name} का खाता बन गया।',
    ],
    en: [
      'Saved {name} in your contacts.',
      'Got it, added {name} as a new contact.',
      'Done, {name} is now in the list.',
    ]
  },
  fund_transfer: {
    bn: [
      'জি, {amount} টাকা ট্রান্সফার করে দিলাম।',
      'ঠিক আছে, {wallet} এ {amount} টাকা পাঠিয়ে দিয়েছি।',
      'টাকা ট্রান্সফার সফল হয়েছে, হিসাব আপডেট করে দিলাম।',
    ],
    hi: [
      'जी, {amount} रुपये ट्रांसफर कर दिए।',
      'ठीक है, {wallet} में {amount} रुपये भेज दिए हैं।',
      'पैसे ट्रांसफर हो गए, खाता अपडेट कर दिया।',
    ],
    en: [
      'Transferred {amount} taka successfully.',
      'Got it, sent {amount} taka to {wallet}.',
      'Done, {amount} taka fund transfer logged.',
    ]
  },
  owner_draw: {
    bn: [
      'মালিকানার খরচ হিসেবে {amount} টাকা তুলে নেওয়ার হিসাব রাখলাম।',
      'জি, আপনি {amount} টাকা ক্যাশ থেকে তুলে নিয়েছেন, লিখে দিলাম।',
      'ঠিক আছে, আপনার ব্যক্তিগত খরচের জন্য {amount} টাকা এন্ট্রি হলো।',
    ],
    hi: [
      'मालिक के खर्चे के तौर पर {amount} रुपये दर्ज कर लिए।',
      'जी, आपने कैश से {amount} रुपये निकाले हैं, लिख दिया।',
      'ठीक है, निजी खर्च के लिए {amount} रुपये दर्ज हो गए।',
    ],
    en: [
      'Recorded owner withdrawal of {amount} taka.',
      'Got it, logged {amount} taka as personal draw.',
      'Done, {amount} taka drawn from cash.',
    ]
  },
  owner_inject: {
    bn: [
      'দোকানের ক্যাশে আপনার দেওয়া {amount} টাকা মূলধন হিসেবে যোগ করলাম।',
      'জি, ব্যবসায় নতুন করে {amount} টাকা দিলেন, হিসাব তুলে নিয়েছি।',
      'ঠিক আছে, মূলধন হিসেবে {amount} টাকা এন্ট্রি করে দিলাম।',
    ],
    hi: [
      'दुकान में {amount} रुपये की पूंजी जोड़ दी गई है।',
      'जी, व्यापार में {amount} रुपये निवेश दर्ज कर लिया।',
      'ठीक है, पूंजी के तौर पर {amount} रुपये लिख दिए।',
    ],
    en: [
      'Added {amount} taka to business capital.',
      'Got it, logged owner investment of {amount} taka.',
      'Done, {amount} taka injected into cash.',
    ]
  },
  damage: {
    bn: [
      'ক্ষতি হিসেবে {amount} টাকার {product} হিসাব থেকে বাদ দিলাম।',
      'জি, নষ্ট হয়ে যাওয়া {product} এর ক্ষতি লিখে রাখলাম।',
      'ঠিক আছে, ড্যামেজ হিসেবে {product} স্টকের হিসাব থেকে কমিয়ে দিয়েছি।',
    ],
    hi: [
      'नुकसान के तौर पर {amount} रुपये का {product} हटा दिया।',
      'जी, खराब हुए {product} का नुकसान लिख दिया है।',
      'ठीक है, डैमेज आइटम स्टॉक से कम कर दिया।',
    ],
    en: [
      'Recorded damage of {product} worth {amount} taka.',
      'Got it, removed damaged {product} from stock.',
      'Done, logged {amount} taka inventory loss.',
    ]
  },
  salary_pay: {
    bn: [
      '{contact} এর বেতন বাবদ {amount} টাকা পরিশোধ লিখে রাখলাম।',
      'জি, কর্মচারীর বেতন {amount} টাকা দেওয়া হলো, এন্ট্রি করে দিয়েছি।',
      'ঠিক আছে, বেতন হিসেবে {amount} টাকা খরচের খাতায় যোগ হলো।',
    ],
    hi: [
      '{contact} को वेतन के तौर पर {amount} रुपये देना लिख दिया।',
      'जी, कर्मचारी को {amount} रुपये वेतन दे दिया है।',
      'ठीक है, सैलरी के लिए {amount} रुपये दर्ज कर लिए।',
    ],
    en: [
      'Paid {amount} taka salary to {contact}.',
      'Got it, logged salary payment of {amount} taka.',
      'Done, {amount} taka salary expense recorded.',
    ]
  },
  recharge: {
    bn: [
      'মোবাইল রিচার্জ বাবদ {amount} টাকা খরচের হিসাব রাখলাম।',
      'জি, {amount} টাকার ফ্লেক্সিলোড বা রিচার্জ হয়ে গেছে।',
      'ঠিক আছে, {amount} টাকা রিচার্জের এন্ট্রি করে দিলাম।',
    ],
    hi: [
      'मोबाइल रिचार्ज के {amount} रुपये दर्ज कर लिए।',
      'जी, {amount} रुपये का रिचार्ज हो गया है।',
      'ठीक है, {amount} रुपये का रिचार्ज लिख दिया।',
    ],
    en: [
      'Recorded mobile recharge of {amount} taka.',
      'Got it, logged {amount} taka top-up.',
      'Done, {amount} taka recharge expense added.',
    ]
  },
  service_income: {
    bn: [
      'সার্ভিস থেকে {amount} টাকা আয় হলো, লিখে রাখলাম।',
      'জি, আপনার সেবার বিনিময়ে পাওয়া {amount} টাকা আয়ের খাতায় যোগ করলাম।',
      'ঠিক আছে, সার্ভিস ইনকাম হিসেবে {amount} টাকা এন্ট্রি করে দিয়েছি।',
    ],
    hi: [
      'सर्विस से {amount} रुपये की कमाई दर्ज कर ली।',
      'जी, सेवा के बदले मिले {amount} रुपये आय में जोड़ दिए।',
      'ठीक है, सर्विस इनकम के तौर पर {amount} रुपये लिख दिए।',
    ],
    en: [
      'Recorded service income of {amount} taka.',
      'Got it, logged {amount} taka earned from services.',
      'Done, {amount} taka added to service revenue.',
    ]
  },
  credit_sale: {
    bn: [
      '{contact} এর কাছে {amount} টাকার বাকিতে বিক্রি লিখে রাখলাম।',
      'জি, {amount} টাকার পণ্য বাকিতে দেওয়া হলো, হিসাব তুলে নিয়েছি।',
      'ঠিক আছে, {contact} এর বাকি খাতায় {amount} টাকা যোগ করে দিলাম।',
    ],
    hi: [
      '{contact} को {amount} रुपये की उधार बिक्री दर्ज कर ली।',
      'जी, {amount} रुपये का सामान उधार दिया गया।',
      'ठीक है, {contact} के खाते में {amount} रुपये का उधार जोड़ दिया।',
    ],
    en: [
      'Recorded credit sale of {amount} taka to {contact}.',
      'Got it, logged {amount} taka credit purchase by {contact}.',
      'Done, {amount} taka added to {contact} dues.',
    ]
  },
  day_open: {
    bn: [
      'দোকান খোলা হলো, আজকের বেচাকেনা ভালো হোক এই দোয়া করি।',
      'জি, আজকের হিসাব শুরু করলাম। আল্লাহ বরকত দিন।',
      'শুভ সকাল! ক্যাশ কাউন্টার ওপেন করে দিয়েছি, কাজ শুরু করতে পারেন।',
    ],
    hi: [
      'दुकान खुल गई है, आज की बिक्री अच्छी हो।',
      'जी, आज का हिसाब शुरू कर दिया है।',
      'सुप्रभात! कैश काउंटर खोल दिया है।',
    ],
    en: [
      'Store opened for the day. Have a great day ahead!',
      'Got it, started today\'s ledger.',
      'Good morning! Cash register is now open.',
    ]
  },
  day_close: {
    bn: [
      'আজকের মত হিসাব বন্ধ করলাম, মোট বিক্রি হয়েছে {total} টাকা।',
      'জি, সারা দিনের হিসাব মিলিয়ে দিন ক্লোজ করে দিলাম।',
      'ঠিক আছে, আজকের হিসাব শেষ। বিশ্রাম নিন।',
    ],
    hi: [
      'आज का हिसाब बंद कर दिया, कुल बिक्री {total} रुपये हुई।',
      'जी, दिन भर का हिसाब मिला कर बंद कर दिया है।',
      'ठीक है, आज का काम खत्म। आराम करें।',
    ],
    en: [
      'Closed for the day. Total sales: {total} taka.',
      'Got it, daily ledger closed and tallied.',
      'Done, day closed. Have a good rest!',
    ]
  },
  undo: {
    bn: [
      'ঠিক আছে, আগের কাজটা বাতিল করে দিয়েছি।',
      'জি, ভুল এন্ট্রিটা মুছে ফেললাম।',
      'হয়ে গেছে, শেষের হিসাবটা আমি বাদ দিয়ে দিয়েছি।',
    ],
    hi: [
      'ठीक है, पिछला काम रद्द कर दिया।',
      'जी, गलत एंट्री हटा दी है।',
      'हो गया, आखिरी हिसाब मिटा दिया।',
    ],
    en: [
      'Alright, reverted the last action.',
      'Got it, removed the incorrect entry.',
      'Done, undid the previous step.',
    ]
  },
  check_price: {
    bn: [
      '{product} এর দাম এখন {amount} টাকা।',
      'জি, {product} এর মূল্য দেওয়া আছে {amount} টাকা।',
      'আমার হিসাব মতে, {product} বিক্রি হচ্ছে {amount} টাকায়।',
    ],
    hi: [
      '{product} की कीमत अभी {amount} रुपये है।',
      'जी, {product} का दाम {amount} रुपये है।',
      'मेरे हिसाब से, {product} {amount} रुपये में बिक रहा है।',
    ],
    en: [
      'The price of {product} is {amount} taka.',
      'Got it, {product} costs {amount} taka.',
      'Currently, {product} is priced at {amount} taka.',
    ]
  },
  check_stock: {
    bn: [
      'আপনার দোকানে এখন {quantity} {unit} {product} আছে।',
      'জি, আমি দেখে বলছি, {product} স্টকে আছে {quantity} {unit}।',
      'হিসাব বলছে, {product} আর {quantity} {unit} বাকি আছে।',
    ],
    hi: [
      'आपकी दुकान में अभी {quantity} {unit} {product} है।',
      'जी, {product} का स्टॉक {quantity} {unit} है।',
      'हिसाब से, {product} {quantity} {unit} बचा है।',
    ],
    en: [
      'You currently have {quantity} {unit} of {product} in stock.',
      'Checking... {product} stock is at {quantity} {unit}.',
      'There are {quantity} {unit} of {product} remaining.',
    ]
  },
  check_due: {
    bn: [
      '{contact} ভাইয়ের কাছে মোট {amount} টাকা পাওনা আছে।',
      'জি, {contact} এর বাকির পরিমাণ হলো {amount} টাকা।',
      'হিসাব বলছে, {contact} এর কাছে আপনি {amount} টাকা পাবেন।',
    ],
    hi: [
      '{contact} पर कुल {amount} रुपये उधार है।',
      'जी, {contact} का बकाया {amount} रुपये है।',
      'हिसाब से, {contact} से {amount} रुपये लेने हैं।',
    ],
    en: [
      '{contact} owes you {amount} taka in total.',
      'Got it, {contact} has a due of {amount} taka.',
      'The outstanding balance for {contact} is {amount} taka.',
    ]
  },
  check_balance: {
    bn: [
      'আপনার ক্যাশে এখন মোট {amount} টাকা আছে।',
      'জি, আজকের হিসাব অনুযায়ী ব্যালেন্স হলো {amount} টাকা।',
      'সব মিলিয়ে আপনার হাতে ক্যাশ আছে {amount} টাকা।',
    ],
    hi: [
      'आपके कैश में अभी {amount} रुपये हैं।',
      'जी, आज के हिसाब से बैलेंस {amount} रुपये है।',
      'कुल मिलाकर आपके पास {amount} रुपये कैश है।',
    ],
    en: [
      'Your current cash balance is {amount} taka.',
      'Got it, the total balance stands at {amount} taka.',
      'You have {amount} taka in cash available.',
    ]
  },
  mishearing: {
    bn: [
      'আমি কথাটা স্পষ্ট বুঝতে পারিনি, আরেকবার বলবেন কি?',
      'মাফ করবেন, আওয়াজটা কেটে গেল। আবার বলুন।',
      'আমি ঠিক শুনতে পাইনি। টাকার অংকটা আরেকবার বলবেন?',
    ],
    hi: [
      'मैं ठीक से समझ नहीं पाया, क्या आप फिर से कहेंगे?',
      'माफ़ करें, आवाज़ कट गई थी। फिर से बोलें।',
      'मैंने ठीक से सुना नहीं। एक बार और बताएंगे?',
    ],
    en: [
      'I didn\'t quite catch that, could you repeat?',
      'Sorry, the audio was unclear. Please say that again.',
      'I couldn\'t hear you properly. Could you say the amount again?',
    ]
  },
  thinking: {
    bn: [
      'একটু সময় দিন...',
      'হিসাব মিলিয়ে দেখছি...',
      'জি, আমি এন্ট্রি করছি...',
    ],
    hi: [
      'थोड़ा समय दें...',
      'हिसाब मिला रहा हूँ...',
      'जी, मैं दर्ज कर रहा हूँ...',
    ],
    en: [
      'Just a moment...',
      'Checking the ledger...',
      'Logging it in...',
    ]
  }
};

/**
 * Gets a random humanized response for a given action.
 * Ensures the same response is not used twice consecutively.
 * 
 * @param {string} actionType - The type of action (e.g., 'expense', 'sale')
 * @param {string} [lang='bn'] - Language code ('bn', 'hi', 'en')
 * @param {Object} [data={}] - Template variables to replace
 * @returns {string} The humanized response string
 */
export function getHumanResponse(actionType, lang = 'bn', data = {}) {
  const defaultFallback = {
    bn: 'ঠিক আছে, আপনার কাজটি সম্পন্ন হয়েছে।',
    hi: 'ठीक है, आपका काम हो गया है।',
    en: 'Alright, your action has been completed.'
  };

  const actions = RESPONSE_VARIANTS[actionType];
  if (!actions) {
    return defaultFallback[lang] || defaultFallback['bn'];
  }

  const variants = actions[lang] || actions['bn'];
  if (!variants || variants.length === 0) {
    return defaultFallback[lang] || defaultFallback['bn'];
  }

  const key = `${actionType}_${lang}`;
  const lastIndex = lastUsedVariant.get(key) ?? -1;
  
  let randomIndex = Math.floor(Math.random() * variants.length);
  if (variants.length > 1 && randomIndex === lastIndex) {
    randomIndex = (randomIndex + 1) % variants.length;
  }
  
  lastUsedVariant.set(key, randomIndex);
  let response = variants[randomIndex];

  for (const [k, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{${k}\\}`, 'g');
    response = response.replace(regex, value);
  }

  return response;
}

/**
 * Converts markdown-rich display text into clean text suitable for Text-To-Speech (TTS).
 * 
 * @param {string} markdownText - The text containing markdown
 * @returns {string} Clean spoken text
 */
export function toSpokenText(markdownText) {
  if (!markdownText) return '';
  
  let spoken = markdownText;
  
  // Strip markdown bold/italic
  spoken = spoken.replace(/\*\*([^*]+)\*\*/g, '$1');
  spoken = spoken.replace(/\*([^*]+)\*/g, '$1');
  // Strip markdown headers
  spoken = spoken.replace(/^#{1,6}\s+/gm, '');
  // Strip bullet points
  spoken = spoken.replace(/^[•\-*]\s+/gm, '');
  // Strip brackets and parens
  spoken = spoken.replace(/[[\]()]/g, ' ');
  
  // Remove emojis
  spoken = spoken.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
  
  // Convert ৳ to টাকা
  spoken = spoken.replace(/৳/g, ' টাকা ');
  
  // Convert newlines to commas for TTS pause
  spoken = spoken.replace(/\n+/g, ', ');
  
  // Collapse multiple spaces and trim
  spoken = spoken.replace(/\s+/g, ' ').trim();
  
  return spoken;
}

/**
 * Gets a natural cognitive pause filler while the AI is thinking or processing.
 * 
 * @param {string} [lang='bn'] - Language code
 * @returns {string} A thinking filler phrase
 */
export function getThinkingFiller(lang = 'bn') {
  return getHumanResponse('thinking', lang);
}

/**
 * Gets a context-aware time-based greeting for the user.
 * 
 * @param {string} [lang='bn'] - Language code
 * @param {Object} [context={}] - Contextual data
 * @returns {string} A natural greeting
 */
export function getTimeGreeting(lang = 'bn', context = {}) {
  const hour = new Date().getHours();
  
  if (lang !== 'bn') {
    if (hour >= 5 && hour < 12) return lang === 'hi' ? 'सुप्रभात!' : 'Good morning!';
    if (hour >= 12 && hour < 17) return lang === 'hi' ? 'नमस्ते!' : 'Good afternoon!';
    if (hour >= 17 && hour < 21) return lang === 'hi' ? 'शुभ संध्या!' : 'Good evening!';
    return lang === 'hi' ? 'नमस्ते!' : 'Good night!';
  }

  if (hour >= 5 && hour < 12) {
    let greeting = 'সুপ্রভাত! আজকের দিনটি ভালো কাটুক।';
    if (context.yesterdaySales) {
      greeting = `সুপ্রভাত! গতকাল ${context.yesterdaySales} টাকার বিক্রি হয়েছিল, আজ আরও ভালো হবে ইনশাআল্লাহ।`;
    }
    return greeting;
  } else if (hour >= 12 && hour < 17) {
    let greeting = 'দুপুরের সালাম! কাজ কেমন চলছে?';
    if (context.todaySales) {
      greeting = `দুপুরের সালাম! আজ এখন পর্যন্ত ${context.todaySales} টাকার বিক্রি হয়েছে।`;
    }
    return greeting;
  } else if (hour >= 17 && hour < 21) {
    let greeting = 'সন্ধ্যা হয়ে গেছে। বেচাকেনার ভালো সময়।';
    if (context.dueCount) {
      greeting = `সন্ধ্যা হয়ে গেছে। আপনার ${context.dueCount} জনের বাকি আদায়ের কথা মনে আছে তো?`;
    }
    return greeting;
  } else {
    let greeting = 'রাত হয়ে গেছে। আজকের মত কাজ শেষ করে বিশ্রাম নিন।';
    if (context.totalSales) {
      greeting = `রাত হয়ে গেছে। আজ মোট ${context.totalSales} টাকার বিক্রি হয়েছে, মাশাআল্লাহ।`;
    }
    return greeting;
  }
}

/**
 * Gets a graceful response when the user's speech wasn't clearly understood.
 * 
 * @param {string} [lang='bn'] - Language code
 * @param {Object} [partialData={}] - Partial data understood from speech
 * @returns {string} A natural mishearing prompt
 */
export function getMishearingResponse(lang = 'bn', partialData = {}) {
  if (lang !== 'bn') {
    return getHumanResponse('mishearing', lang);
  }
  
  if (partialData.amount && !partialData.action) {
    return `আপনি কি ${partialData.amount} টাকার কথা বলেছিলেন? ঠিক বুঝতে পারিনি, আরেকবার বলুন।`;
  } else if (partialData.contact && !partialData.amount) {
    return `${partialData.contact} ভাইয়ের কী হিসাব হবে, সেটা স্পষ্ট শুনতে পাইনি। আবার বলবেন?`;
  }
  
  return getHumanResponse('mishearing', lang);
}
