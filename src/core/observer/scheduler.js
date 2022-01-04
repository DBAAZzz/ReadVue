/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools,
  inBrowser,
  isIE
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
let has: { [key: number]: ?true } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let index = 0

/**
 * Reset the scheduler's state.
 */
function resetSchedulerState() {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

// Async edge case #6566 requires saving the timestamp when event listeners are
// attached. However, calling performance.now() has a perf overhead especially
// if the page has thousands of event listeners. Instead, we take a timestamp
// every time the scheduler flushes and use that for all event listeners
// attached during that flush.
export let currentFlushTimestamp = 0

// Async edge case fix requires storing an event listener's attach timestamp.
let getNow: () => number = Date.now

// Determine what event timestamp the browser is using. Annoyingly, the
// timestamp can either be hi-res (relative to page load) or low-res
// (relative to UNIX epoch), so in order to compare time we have to use the
// same timestamp type when saving the flush timestamp.
// All IE versions use low-res event timestamps, and have problematic clock
// implementations (#9632)
if (inBrowser && !isIE) {
  const performance = window.performance
  if (
    performance &&
    typeof performance.now === 'function' &&
    getNow() > document.createEvent('Event').timeStamp
  ) {
    // if the event timestamp, although evaluated AFTER the Date.now(), is
    // smaller than it, it means the event is using a hi-res timestamp,
    // and we need to use the hi-res version for event listener timestamps as
    // well.
    getNow = () => performance.now()
  }
}

/**
 * Flush both queues and run the watchers.
 * 刷新队列，由 flushCallbacks 函数负责调用，主要做了如下两件事：
 *    1、更新 flushing 为 true，表示正在刷新队列，在此期间往队列 push 新的 watcher 时需要做特殊处理（将其放在队列的合适位置上）
 *    2、按照队列中的 watcher.id 从小到大排序，保证先创建的 watcher 先执行
 *    3、遍历 wathcer 队列，依次执行 watcher.before、watcher.run 并清空缓存的 watcher
 */
function flushSchedulerQueue() {
  currentFlushTimestamp = getNow()
  // 标志现在正在刷新队列
  flushing = true
  let watcher, id

  /**
   * 刷新队列之前可以先给队列排序（升序），可以保证
   *    1、组件的更新顺序为从父级到子级，因为父组件总是在子组件之前被创建
   *    2、一个组件的用户 watcher 在其渲染 wathcer 之前被执行，因为用户的 watcher 先于渲染 wathcer 创建
   *    3、如果一个组件在其父组件的 watcher 执行期间被销毁，则他的 watcher 可以被跳过
   */
  queue.sort((a, b) => a.id - b.id)

  // 这里直接使用了 queue.length，动态计算队列的长度，没有缓存长度，是因为在执行现有 watcher 期间队列中可能会被 push 进新的 watcher
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    if (watcher.before) {
      watcher.before()
    }
    id = watcher.id
    has[id] = null
    watcher.run()
    // in dev build, check and stop circular updates.
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
        break
      }
    }
  }

  // keep copies of post queues before resetting state
  const activatedQueue = activatedChildren.slice()
  const updatedQueue = queue.slice()

  resetSchedulerState()

  // call component updated and activated hooks
  callActivatedHooks(activatedQueue)
  callUpdatedHooks(updatedQueue)

  // devtool hook
  /* istanbul ignore if */
  if (devtools && config.devtools) {
    devtools.emit('flush')
  }
}

function callUpdatedHooks(queue) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm._watcher === watcher && vm._isMounted && !vm._isDestroyed) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent(vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks(queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 */
export function queueWatcher(watcher: Watcher) {
  const id = watcher.id
  //  如果 watcher  已经存在，则跳过，不会重复入队
  if (has[id] == null) {
    // 缓存 wathcer.id ，用来判断 watcher 是否已经入队
    has[id] = true
    if (!flushing) {
      // 当前没有处于刷新队列状态，watcher 直接入队
      queue.push(watcher)
    } else {
      // 已经在刷新队列了
      // 从队列末尾开始倒序遍历，根据当前的 watcher.id 找到大于它的 watcher.id 的位置，然后将自己插入到该位置的下一位
      // 即：将当前 watcher 放入到已排序的队列中，且队列仍是有序的
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    if (!waiting) {
      waiting = true

      if (process.env.NODE_ENV !== 'production' && !config.async) {
        flushSchedulerQueue()
        return
      }
      /**
       * 熟悉的 nextTick => vm.$nextTick、Vue.nextTick
       *   1、将 回调函数 （flushSchedulerQueue）放入到 callback 数组
       *   2、通过 pending 控制向浏览器任务队列中添加 flushCallbacks 函数
       */

      nextTick(flushSchedulerQueue)
    }
  }
}
