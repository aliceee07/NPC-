(function () {
  /* ═══════════════════════════════════════════════════════════
     LOOP SCRIPT  —  周目剧本配置层
     职责：持有 1–10 周目的：
       1. 三角色 × 两选项的 quick reply 文本；
       2. 测试模式下点击 quick reply 时的固定 mock 回复（reply + touched + closing_signal）；
       3. 测试模式下的占位日记正文（直接显示，无需 AI 生成）。
     依赖：无
     被消费：dialogue.js（quick reply 渲染 + 测试模式短路 mock）、loop.js（测试占位日记）。
     对外暴露：window.LoopScript
  ═══════════════════════════════════════════════════════════ */

  /* 通用「再见」与「我恨你」回复构造器（第 7/8 周目共用）：
     - 「我恨你们」走「冷淡反应」：touched=false（重复发泄不会再触动谁）；
     - 「可以陪陪我吗？」走「触发对应主题回忆」：touched=true。 */
  function buildAccompany78(charId) {
    if (charId === "char1") {
      return "想一起看看书吗？我手边那本翻到一半，看完一起讨论。你坐下来我就翻给你看。";
    }
    if (charId === "char2") {
      return "陪你？也行。反正我也想找个人吵两句，省得自己跟自己生闷气。";
    }
    return "好啊。要不要我帮你打扮一下？换身衣服，扎一下头发，今天会好一点的。";
  }

  function buildHate78(charId) {
    if (charId === "char1") {
      return "你想恨就恨吧。我接得住。";
    }
    if (charId === "char2") {
      return "随你。你恨我，我也不会因为这个改变什么。";
    }
    return "对不起。如果是我让你恨的，就把它放在我这儿吧。";
  }

  /* mock 模板：reply 字段必填；touched / closing_signal 默认 false */
  function mk(reply, touched, closing) {
    return {
      reply: String(reply || ""),
      touched: !!touched,
      closing_signal: !!closing,
    };
  }

  const QUICK_REPLIES_BY_LOOP = {
    1: {
      char1: [
        { text: "你常来这条街吗？我好像迷路了。",
          mock: mk("不常来。只是这条街很直，适合假装自己知道要去哪。", true, false) },
        { text: "你看起来很孤独。",
          mock: mk("这句话太方便了，像从便利店买来的同情。", false, false) },
      ],
      char2: [
        { text: "你知道这里是哪里吗？",
          mock: mk("你问路的样子像在等一个世界观说明。可惜我不是那种好心 NPC。", true, false) },
        { text: "你看起来想找人聊聊。",
          mock: mk("少来。你们这种人最擅长把别人当成情绪支线。", false, true) },
      ],
      char3: [
        { text: "你今天看起来不太好。",
          mock: mk("有这么明显吗？不，我是说你可能看错了。", true, false) },
        { text: "你愿意跟我聊聊吗？我好像迷路了。",
          mock: mk("可以呀。迷路的人如果坐下来，就暂时不像迷路了。", true, false) },
      ],
    },

    2: {
      char1: [
        { text: "如果你看见有人遇到危险，你会帮忙吗？",
          mock: mk("我会先判断我是不是帮得上。大多数时候，答案都很难看。", true, false) },
        { text: "你是不是那种不会管闲事的人？",
          mock: mk("是。你想听这个答案的话，我可以直接给你。", false, false) },
      ],
      char2: [
        { text: "你觉得一个人冲上去救人，是勇敢还是愚蠢？",
          mock: mk("看结果。赢了叫勇敢，输了叫不自量力。人类就这么势利。", true, false) },
        { text: "你肯定很会骂人吧。",
          mock: mk("你对我的理解就停在这个层级？行，挺省事。", false, false) },
      ],
      char3: [
        { text: "如果有人杀人，你会害怕吗？",
          mock: mk("会。", false, false) },
        { text: "你会帮我吗？",
          mock: mk("你在说什么？", false, false) },
      ],
    },

    3: {
      char1: [
        { text: "你知道哪里有花店吗？",
          mock: mk("往前走。", true, false) },
        { text: "如果我送你花，你会开心吗？",
          mock: mk("我们熟到这个程度了吗？", false, false) },
      ],
      char2: [
        { text: "你觉得送花俗吗？",
          mock: mk("你很习惯一上来就对陌生人问一些不明所以的东西吗？", true, false) },
        { text: "你知道哪里有花店吗？",
          mock: mk("前面有一家，我刚刚路过。", false, false) },
      ],
      char3: [
        { text: "我想买一束花，但不知道送给谁。",
          mock: mk("那就先送给你自己吧。没人规定花必须是别人给的。", true, false) },
        { text: "你知道哪里有花店吗？",
          mock: mk("你在说什么？这里不就是吗？", false, false) },
      ],
    },

    4: {
      char1: [
        { text: "如果我死了你会救我吗？",
          mock: mk("……你在莫名其妙说什么？", false, false) },
        { text: "你看起来很冷漠。",
          mock: mk("你说得对。", true, false) },
      ],
      char2: [
        { text: "你当时也在，对吗？",
          mock: mk("你在莫名其妙说什么？别问得像审判开庭。", false, false) },
        { text: "你可以救救我吗？",
          mock: mk("你在莫名其妙说什么？", true, false) },
      ],
      char3: [
        { text: "你记得我吗？",
          mock: mk("不记得。可是你这样看着我，我觉得我应该道歉。", true, false) },
        { text: "我一会就要死了。",
          mock: mk("因为哭比行动容易。哭的时候，我还能觉得自己是善良的人。", true, false) },
      ],
    },

    5: {
      char1: [
        { text: "我一次次死，你却一次次站着看。",
          mock: mk("你又在说那种话……不像迷路，倒像脑子里有什么在响。你还好吗？", true, false) },
        { text: "我讨厌你。",
          mock: mk("也许吧。但你不是第一个这么想的人。我自己也这么想过。", false, false) },
      ],
      char2: [
        { text: "我要死了。",
          mock: mk("很好的哲学命题。可惜你说得没有质感——你是真的要死，还是又想用「死」这个词压一压气氛？", true, false) },
        { text: "我讨厌你。",
          mock: mk("我也讨厌你。但你能站在这里跟我说这句，说明我们至少还能对话——这就比大多数人强。", false, false) },
      ],
      char3: [
        { text: "你哭的时候，有没有想过我还活着？",
          mock: mk("你在说什么？", false, false) },
        { text: "别装可怜了。",
          mock: mk("我没有……不，也许我有。对不起。", true, false) },
      ],
    },

    6: {
      char1: [
        { text: "如果不是这一天，我们会不会一起看完一本书？",
          mock: mk("会吧。你会嫌我翻页慢，我会假装没听见。", true, false) },
        { text: "如果不是这一天，我差点以为我们能成为朋友。",
          mock: mk("差点也算发生过一点点。", true, false) },
      ],
      char2: [
        { text: "如果我们有明天，你想做什么？",
          mock: mk("先买件不那么丑的外套。然后找个地方坐着，骂路人的品味。你可以负责反驳我。", true, false) },
        { text: "你知道吗，有一轮我觉得你挺好笑。",
          mock: mk("有一轮？你是说又一次吗？", false, false) },
      ],
      char3: [
        { text: "如果明天真的会来，你想去哪？",
          mock: mk("去很亮的地方。不是为了被看见，只是想证明我也能站在那里。", true, false) },
        { text: "我们以前是不是也这样说过话？",
          mock: mk("我不记得。但我希望是。", true, false) },
      ],
    },

    7: {
      char1: [
        { text: "我恨你们。",
          mock: mk(buildHate78("char1"), false, false) },
        { text: "可以陪陪我吗？",
          mock: mk(buildAccompany78("char1"), true, false) },
      ],
      char2: [
        { text: "我恨你们。",
          mock: mk(buildHate78("char2"), false, false) },
        { text: "可以陪陪我吗？",
          mock: mk(buildAccompany78("char2"), true, false) },
      ],
      char3: [
        { text: "我恨你们。",
          mock: mk(buildHate78("char3"), false, false) },
        { text: "可以陪陪我吗？",
          mock: mk(buildAccompany78("char3"), true, false) },
      ],
    },

    8: {
      char1: [
        { text: "我恨你们。",
          mock: mk(buildHate78("char1"), false, false) },
        { text: "可以陪陪我吗？",
          mock: mk(buildAccompany78("char1"), true, false) },
      ],
      char2: [
        { text: "我恨你们。",
          mock: mk(buildHate78("char2"), false, false) },
        { text: "可以陪陪我吗？",
          mock: mk(buildAccompany78("char2"), true, false) },
      ],
      char3: [
        { text: "我恨你们。",
          mock: mk(buildHate78("char3"), false, false) },
        { text: "可以陪陪我吗？",
          mock: mk(buildAccompany78("char3"), true, false) },
      ],
    },

    9: {
      char1: [
        { text: "再见。",
          mock: mk("我们那本书最后没读完。下次——如果还有下次，记得替我翻到最后一页。", true, false) },
        { text: "我恨你。",
          mock: mk("我知道。可是你站在这里说这句话，比走开难。我接住了。", false, false) },
      ],
      char2: [
        { text: "再见。",
          mock: mk("再见？听起来挺正式。要不下次再见还是吵一架——那才像我们。", true, false) },
        { text: "我恨你。",
          mock: mk("行。你恨吧。比走情感套路真实多了。", false, false) },
      ],
      char3: [
        { text: "再见。",
          mock: mk("如果未来真的来了，你要替我活得漂亮一点——亮一点的颜色，不要再总是灰的。", true, false) },
        { text: "我恨你。",
          mock: mk("……对不起。对不起。", false, false) },
      ],
    },

    10: {
      char1: [
        { text: "再见。",
          mock: mk("再见。今天这一页，我读完了。", true, false) },
        { text: "谢谢你。",
          mock: mk("不客气。下次见到你的时候，记得替我把没看完的那页翻过去。", true, false) },
      ],
      char2: [
        { text: "再见。",
          mock: mk("再见——别哭得太难看，那不是你的风格。", true, false) },
        { text: "谢谢你。",
          mock: mk("不用谢。你要是真想谢，就替我活到一个能买得起体面外套的明天。", true, false) },
      ],
      char3: [
        { text: "再见。",
          mock: mk("再见。我会记得你，至少这一次，我们是朋友。", true, false) },
        { text: "谢谢你。",
          mock: mk("……谢谢你愿意把我当成一个人，而不是一个角落里的灯。", true, false) },
      ],
    },
  };

  /* 测试模式占位日记：玩家「直接显示」的版本（不走 AI 生成）。
     注意：实际 AI 走 ending.js 的 runNotebookGeneration；
     这里的内容仅用于跳周目测试 / mock 路径下的日记显示。 */
  const TEST_NOTEBOOK_BODY_BY_LOOP = {
    1: [
      "我不知道这里是哪里。我和三个人说了话。",
      "后来时间到了。有人杀了我。",
      "我想弄清楚这是怎么回事。",
    ].join("\n"),

    2: [
      "我又回来了。",
      "我又死了一次。",
      "快结束的时候，我好像看见了一家花店。",
      "不知道为什么，我觉得那很重要。",
    ].join("\n"),

    3: [
      "我还是不知道为什么会死。",
      "可是我一直想起花店。",
      "我想买花。这个念头像不是我的，又像一直都是我的。",
    ].join("\n"),

    4: "我又死了。我想起来了——我只是想买一束花，就这一件事。然后他杀了我。",

    5: [
      "我不想再死了。我恨他们。",
      "我想起来了……我都想起来了……我恨他们……",
      "为什么让我一遍遍经历这一天。",
      "……太残忍了。",
    ].join("\n"),

    6: [
      "我恨他们……为什么……为什么……",
      "我想起了一些不该存在的东西……",
      "我们看过书，吵过架，买过衣服，还说过明天。",
      "可为什么……我还想起来了……他们为什么……",
      "他们为什么只看着我……为什么……",
    ].join("\n"),

    /* 第 7 周目：前 3 条计数 + <del> 反复涂抹 */
    7: [
      "<del>第 12 周目</del>第 17 周目：我又问了她同样的问题。她还是说不记得。",
      "<del>第 19</del>第 23 周目：他今天没有骂我。我反而有点慌。",
      "第 31 周目：她说我们是朋友。<del>我们是朋友吗</del>……",
      "我不知道这是第几遍了，也不知道再写下去有没有意义。我又…",
    ].join("\n"),

    /* 第 8 周目：在前 3 条基础上继续叠加，模糊字迹更多，末尾断句 */
    8: [
      "<del>第 12 周目</del>第 17 周目：我又问了她同样的问题。",
      "第 23 周目：他今天没有骂我。",
      "第 31 周目：她说我们是朋友。<del>我们是朋友吗</del>",
      "<del>第 38</del>第 40 周目：我试过刀。没用。",
      "第 52 周目：我试过不说话。<del>也没</del>也没用。",
      "第 68 周目：花店还在那里。<del>我还是没买到</del>……",
      "我又……我又……",
    ].join("\n"),

    /* 第 9 周目：发现真相 + 疲惫 + 有人离开（送花）+ 想结束 */
    9: [
      "我太累了。",
      "我好像知道发生了什么。这条街上少了一个人——她真的离开了。",
      "她临走前把一束花放下了。原来不是「带走」才叫离开，是「把什么留下」之后人就走了。",
      "我也想结束这一切。如果还有一次，我想替自己留下点什么，然后离开。",
    ].join("\n"),

    /* 第 10 周目：一切消失，然后自己也离开 */
    10: [
      "花店不见了。",
      "那三个人也不在了。",
      "街角安静得像从来没热闹过。",
      "我合上本子。",
      "我也该走了。",
    ].join("\n"),
  };

  function safeLoopIndex(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    if (i < 1 || i > 10) return null;
    return i;
  }

  function getQuickReplies(charId, loopIndex) {
    const i = safeLoopIndex(loopIndex);
    if (i === null || !charId) return null;
    const bucket = QUICK_REPLIES_BY_LOOP[i];
    if (!bucket) return null;
    const list = bucket[charId];
    if (!Array.isArray(list)) return null;
    return list.map(function (item) {
      return String(item && item.text ? item.text : "");
    });
  }

  function getQuickReplyMock(charId, loopIndex, text) {
    const i = safeLoopIndex(loopIndex);
    if (i === null || !charId) return null;
    const bucket = QUICK_REPLIES_BY_LOOP[i];
    if (!bucket) return null;
    const list = bucket[charId];
    if (!Array.isArray(list)) return null;
    const target = String(text || "").trim();
    if (!target) return null;
    for (let k = 0; k < list.length; k++) {
      const item = list[k];
      if (item && String(item.text).trim() === target) {
        const m = item.mock || {};
        return {
          reply: String(m.reply || ""),
          touched: m.touched === true,
          closing_signal: m.closing_signal === true,
        };
      }
    }
    return null;
  }

  function getTestNotebookBody(loopIndex) {
    const i = safeLoopIndex(loopIndex);
    if (i === null) return "";
    const body = TEST_NOTEBOOK_BODY_BY_LOOP[i];
    return typeof body === "string" ? body : "";
  }

  window.LoopScript = {
    QUICK_REPLIES_BY_LOOP,
    TEST_NOTEBOOK_BODY_BY_LOOP,
    getQuickReplies,
    getQuickReplyMock,
    getTestNotebookBody,
  };
})();
