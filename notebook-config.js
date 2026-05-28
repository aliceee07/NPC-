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
      emotion: "对花店有说不清的执念，对死亡轮回的恐惧，被杀瞬间反复想起花店细节的不解",
      memoryLevel: "low",
      infoSnippet: "她这次又看见了那家花店，心里有种说不清的刺痛感——像是被什么要紧的东西钩住却想不起来为什么；她靠近又退开，心跳加速，怕看见什么会让她再也回不了头。死的瞬间脑子里浮现的仍是那扇橱窗，让她更加不解。",
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
      emotion: "之前轮回中获得的帮助与温暖，与终于想起他们见死不救的恨意之间的撕裂矛盾",
      memoryLevel: "fractured",
      infoSnippet: "她记得他们在之前某些轮回里曾经温柔过、接近过，那些细节真实存在——可她同时记起了他们在关键时刻袖手旁观的样子。「为什么他们从前不救我？」这个问题比愤怒更难熬，她不知道该恨还是该心疼。",
      headerLabel: "第五次轮回",
    },
    6: {
      emotion: "想起某些轮回里和那三个人真实发生过的愉快瞬间，与「我是那个一次次被杀死的人」之间的矛盾痛苦",
      memoryLevel: "fractured",
      infoSnippet: "她是那个一次次死去的主人公；她想起自己曾和他们聊过书、吵过架、说过明天去哪——那些对话是真实的，她感受过温度。可她同时记得：刀落下来的那一刻，他们一个都没有动。她分不清他们是旁观者，还是差一点的朋友。",
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
      emotion: "终于找到了离开的方式，决定放下，疲惫中有一丝松动",
      memoryLevel: "clear",
      infoSnippet: "她是那个被一次次杀死的人；她终于看清了这条街上真正发生过什么，也发现有人曾经真的离开——离开的方式是留下一束花。她累到不想再来一遍，想替自己找到那个出口，决定放下这一切。",
      headerLabel: "第九次轮回",
    },
    10: {
      emotion: "我终于离开——释怀、解脱、告别",
      memoryLevel: "resolved",
      infoSnippet: "她是那个一次次死去、又一次次重来的人；这一次，她终于要离开了。花店、街道、那些面孔……像被收走一样逐一消失；世界空下来，她合上笔记本，这一次是真正的离开，不是轮回。",
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

  // Phase 1 追加——by-stageId wrapper
  window.NotebookConfig = {
    LOOP_NOTEBOOK_TONE,
    getTonePresetFor,
    getFinalLoopIndex,
    isObfuscatedLoop,
    getTonePresetByStageId: function (stageId) {
      var idx = window.StageCatalog ? window.StageCatalog.toLoopIndex(stageId) : null;
      if (idx === null) idx = 1;
      return getTonePresetFor(idx);
    },
    isObfuscatedStage: function (stageId) {
      return stageId === 'dissolution_a' || stageId === 'dissolution_b';
    },
  };
})();
