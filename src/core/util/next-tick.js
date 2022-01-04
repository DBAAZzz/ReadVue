/* @flow */
/* globals MutationObserver */

import { noop } from 'shared/util'
import { handleError } from './error'
import { isIE, isIOS, isNative } from './env'

export let isUsingMicroTask = false

const callbacks = []
let pending = false

/**
 * 做了三件事：
 *    1、将 pending 置为 false
 *    2、清空 callbacks 数组
 *    3、执行 callbacks 数组中的每一个函数（比如 flushSchedulerQueue、用户调用的 nextTick 传递的回调函数 ）
 */
function flushCallbacks () {
  pending = false
  const copies = callbacks.slice(0)
  callbacks.length = 0
  // 遍历 callbacks 函数，执行其中存储的每个 flushSchedulerQueue 函数
  for (let i = 0; i < copies.length; i++) {
    copies[i]()
  }
}

/**
 * 可以看到 timerFunc 的作用很简单，就是将 flushCallbacks 函数放入浏览器的异步队列中
 * 异步队列的优先级
 *    1、Promise.resolve.then
 *    2、MutationObserver 
 *    3、setImmediate // 已经是一个宏任务了，但仍然比 setTimeout 好
 *    4、setTimeout
 */

let timerFunc

if (typeof Promise !== 'undefined' && isNative(Promise)) {
  const p = Promise.resolve()
  // 首选 Promise.resolve.then()
  timerFunc = () => {
    // 在 微任务队列 中放入 flushCallbacks 函数
    p.then(flushCallbacks)
    /**
     * 在有问题的UIWebView中，Promise.then 不会完全中断，但是它可能会陷入怪异的状态
     * 在这种状态下，回调会被推入微任务队列，但队列没有被刷新，直到浏览器需要执行其他工作，例如处理一个计时器
     * 因此，我们可以添加空计时器来“强制”刷新微任务队列
     */
    if (isIOS) setTimeout(noop)
  }
  isUsingMicroTask = true
} else if (!isIE && typeof MutationObserver !== 'undefined' && (
  isNative(MutationObserver) ||
  // PhantomJS and iOS 7.x
  MutationObserver.toString() === '[object MutationObserverConstructor]'
)) {
  // MutationObserver 次之
  let counter = 1
  const observer = new MutationObserver(flushCallbacks)
  const textNode = document.createTextNode(String(counter))
  observer.observe(textNode, {
    characterData: true
  })
  timerFunc = () => {
    counter = (counter + 1) % 2
    textNode.data = String(counter)
  }
  isUsingMicroTask = true
} else if (typeof setImmediate !== 'undefined' && isNative(setImmediate)) {
  //
  timerFunc = () => {
    setImmediate(flushCallbacks)
  }
} else {

  timerFunc = () => {
    setTimeout(flushCallbacks, 0)
  }
}

/**
 * 完成两件事：
 *    1、用 try catch 包装 flushSchedulerQueue 函数，然后将其放入到 callbacks 数组中
 *    2、如果 pending 为 false，表示现在浏览器的任务队列中没有了 flushCallback 函数
 *      如果 pending 为 true，则表示浏览器的任务队列中已经被放入了 flushCallback 函数
 *      待执行 flushCallbacks 函数时，pending 会再次被置为 false，表示下一个 flushCallbacks 函数可以进入浏览器的任务队列了
 */
export function nextTick (cb?: Function, ctx?: Object) {
  let _resolve
  callbacks.push(() => {
    if (cb) {
      try {
        cb.call(ctx)
      } catch (e) {
        handleError(e, ctx, 'nextTick')
      }
    } else if (_resolve) {
      _resolve(ctx)
    }
  })
  if (!pending) {
    pending = true
    // 执行 timerFunc ，在浏览器的任务队列中（首选微任务队列）放入 flushCallbacks 函数
    timerFunc()
  }
  // $flow-disable-line
  if (!cb && typeof Promise !== 'undefined') {
    return new Promise(resolve => {
      _resolve = resolve
    })
  }
}
