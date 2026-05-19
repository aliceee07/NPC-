(function () {
  /* ═══════════════════════════════════════════════════════════
     NOTEBOOK CONFIG  —  跨周目日记骨架表
     职责：持有 1–10 周目的情绪/记忆量/页眉静态预设。
     AI 只能拿到当前周目的 entry，不能看到完整 1–10 表。
     依赖：无
     被消费：loop.js（读取归一化）、ending.js（构造 entry / prompt 时取当前周目预设）
     对外暴露：window.NotebookConfig
  ═══════════════════════════════════════════════════════════ */

  const FINAL_LOOP_INDEX = 10;

  const LOOP_NOTEBOOK_TONE = {
    1: {
      emotion: "初始无知、被杀后的惊惧、想找真相",
      memoryLevel: "low",
      infoSnippet: "她不知道完整真相，只记得自己死了，隐约知道必须弄清这个地方发生了什么。",
      headerLabel: "第一次轮回",
    },
    2: {
      emotion: "看见花店，意识到那很重要",
      memoryLevel: "low",
      infoSnippet: "她注意到花店，并强烈感觉那不是普通背景，但还不知道花与离开的关系。",
      headerLabel: "第二次轮回",
    },
    3: {
      emotion: "莫名想买花，不理解冲动来源",
      memoryLevel: "partial",
      infoSnippet: "她开始想买花，像是身体先于记忆做出的选择；她仍无法解释为什么。",
      headerLabel: "第三次轮回",
    },
    4: {
      emotion: "记起为什么会被杀，恐惧与确认并存",
      memoryLevel: "clear",
      infoSnippet: "她记起自己来这条街只是为了买一束花，却被一个陌生的持刀路人杀死——那三个人她都说过话，可他们只是旁观；痛苦在于她明明只是来买花。",
      headerLabel: "第四次轮回",
    },
    5: {
      emotion: "愤怒崩溃，精神崩坏",
      memoryLevel: "fractured",
      infoSnippet: "她被死亡、旁观和凶手的记忆压垮，愤怒盖过寻找答案的理智。",
      headerLabel: "第五次轮回",
    },
    6: {
      emotion: "想起愉快细节，矛盾痛苦",
      memoryLevel: "fractured",
      infoSnippet: "她想起一些和旁观者相处时真实愉快的细节，因此对恨意产生动摇，痛苦更复杂。",
      headerLabel: "第六次轮回",
    },
    7: {
      emotion: "过渡模糊，疲惫、反复、字迹斑驳",
      memoryLevel: "fractured",
      infoSnippet: "她已经难以分清这是第几次，只剩下一些重复的脸、声音、花和死亡的碎片。书写时会反复写下又划掉。",
      headerLabel: "轮回了不知道多少次……",
    },
    8: {
      emotion: "过渡模糊，接近麻木但仍在寻找出口",
      memoryLevel: "fractured",
      infoSnippet: "她写得越来越少，删改越来越多；记忆不是消失，而是被反复折叠到难以辨认。句子常常半截就停下。",
      headerLabel: "轮回了不知道多少次……",
    },
    9: {
      emotion: "极度疲惫，发现真相，意识到「离开」的方式",
      memoryLevel: "clear",
      infoSnippet: "她终于看清了发生过的事，并发现这条街上有人真的离开了——离开的方式是她把一束花留下。她已经累到不想再来一遍，想要替自己结束这一切。",
      headerLabel: "第九次轮回",
    },
    10: {
      emotion: "释然，目睹一切消散，随后自己也离去",
      memoryLevel: "resolved",
      infoSnippet: "她做完该做的之后，看见花店、街道、那些面孔像被收走一样逐一消失；世界空下来，她也合上笔记本，准备离开。",
      headerLabel: "第十次轮回",
    },
  };

  function getTonePresetFor(loopIndex) {
    const idx = Number(loopIndex);
    if (!Number.isFinite(idx)) return null;
    const preset = LOOP_NOTEBOOK_TONE[idx];
    if (!preset) return null;
    return {
      emotion: preset.emotion,
      memoryLevel: preset.memoryLevel,
      infoSnippet: preset.infoSnippet,
      headerLabel: preset.headerLabel,
    };
  }

  function getFinalLoopIndex() {
    return FINAL_LOOP_INDEX;
  }

  function isObfuscatedLoop(loopIndex) {
    const idx = Number(loopIndex);
    return idx === 7 || idx === 8;
  }

  window.NotebookConfig = {
    LOOP_NOTEBOOK_TONE,
    getTonePresetFor,
    getFinalLoopIndex,
    isObfuscatedLoop,
  };
})();
