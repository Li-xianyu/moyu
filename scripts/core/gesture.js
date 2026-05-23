"use strict";

var Gesture = {
  H_MIN: 10,
  V_LOCK: 12,

  create: function () {
    return { startX: 0, startY: 0, dx: 0, dy: 0, axisLock: "" };
  },

  startFrom: function (ctx, touch) {
    ctx.startX = touch.clientX;
    ctx.startY = touch.clientY;
    ctx.dx = 0;
    ctx.dy = 0;
    ctx.axisLock = "";
  },

  update: function (ctx, touch) {
    ctx.dx = touch.clientX - ctx.startX;
    ctx.dy = Math.abs(touch.clientY - ctx.startY);
  },

  lockVertical: function (ctx, threshold) {
    var t = threshold != null ? threshold : Gesture.V_LOCK;
    if (!ctx.axisLock && ctx.dy > t && ctx.dy > Math.abs(ctx.dx)) {
      ctx.axisLock = "vertical";
    }
  },

  isVertical: function (ctx) {
    return ctx.axisLock === "vertical";
  },

  clear: function (ctx) {
    ctx.startX = 0;
    ctx.startY = 0;
    ctx.dx = 0;
    ctx.dy = 0;
    ctx.axisLock = "";
  }
};
