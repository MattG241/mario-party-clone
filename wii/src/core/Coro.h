// Frame-driven C++20 coroutines: the board game's turn flow is written like the web game's async/await
// code (co_await io.say(...), co_await wait(0.5)), and the scheduler resumes waiting coroutines once a
// frame from the main loop.
#pragma once
#include <coroutine>
#include <cstdlib>
#include <functional>
#include <utility>
#include <vector>

namespace co {

class Scheduler {
 public:
  static Scheduler& get() {
    static Scheduler s;
    return s;
  }
  void atNextFrame(std::coroutine_handle<> h) { next_.push_back(h); }
  // Resume everything that asked for the next frame (call once per frame).
  void tick(float dt) {
    if (paused_) return;
    dt_ = dt;
    time_ += dt;
    std::vector<std::coroutine_handle<>> now;
    now.swap(next_);
    for (auto h : now)
      if (h && !h.done()) h.resume();
  }
  float dt() const { return dt_; }
  double time() const { return time_; }
  void clear() { next_.clear(); }
  // While paused nothing resumes (and wait() timers stand still).
  void setPaused(bool p) { paused_ = p; }
  bool paused() const { return paused_; }

 private:
  std::vector<std::coroutine_handle<>> next_;
  float dt_ = 1.0f / 60.0f;
  double time_ = 0;
  bool paused_ = false;
};

template <typename T>
class Task;

namespace detail {
struct FinalAwaiter {
  bool await_ready() noexcept { return false; }
  template <typename P>
  std::coroutine_handle<> await_suspend(std::coroutine_handle<P> h) noexcept {
    auto c = h.promise().continuation;
    h.promise().finished = true;
    return c ? c : std::noop_coroutine();
  }
  void await_resume() noexcept {}
};
struct PromiseBase {
  std::coroutine_handle<> continuation;
  bool finished = false;
  std::suspend_always initial_suspend() noexcept { return {}; }
  FinalAwaiter final_suspend() noexcept { return {}; }
  void unhandled_exception() { std::abort(); }
};
}  // namespace detail

// A lazily started coroutine returning T (or void). co_await it from another coroutine, or hand a
// Task<void> to spawn() to run it from the main loop.
template <typename T = void>
class Task {
 public:
  struct promise_type : detail::PromiseBase {
    T value{};
    Task get_return_object() { return Task(std::coroutine_handle<promise_type>::from_promise(*this)); }
    void return_value(T v) { value = std::move(v); }
  };
  using Handle = std::coroutine_handle<promise_type>;
  Task() = default;
  explicit Task(Handle h) : h_(h) {}
  Task(Task&& o) noexcept : h_(std::exchange(o.h_, {})) {}
  Task& operator=(Task&& o) noexcept {
    if (this != &o) {
      if (h_) h_.destroy();
      h_ = std::exchange(o.h_, {});
    }
    return *this;
  }
  Task(const Task&) = delete;
  ~Task() {
    if (h_) h_.destroy();
  }
  bool await_ready() const noexcept { return !h_ || h_.promise().finished; }
  std::coroutine_handle<> await_suspend(std::coroutine_handle<> c) noexcept {
    h_.promise().continuation = c;
    return h_;
  }
  T await_resume() { return std::move(h_.promise().value); }

 private:
  Handle h_;
};

template <>
class Task<void> {
 public:
  struct promise_type : detail::PromiseBase {
    Task get_return_object() { return Task(std::coroutine_handle<promise_type>::from_promise(*this)); }
    void return_void() {}
  };
  using Handle = std::coroutine_handle<promise_type>;
  Task() = default;
  explicit Task(Handle h) : h_(h) {}
  Task(Task&& o) noexcept : h_(std::exchange(o.h_, {})) {}
  Task& operator=(Task&& o) noexcept {
    if (this != &o) {
      if (h_) h_.destroy();
      h_ = std::exchange(o.h_, {});
    }
    return *this;
  }
  Task(const Task&) = delete;
  ~Task() {
    if (h_) h_.destroy();
  }
  bool await_ready() const noexcept { return !h_ || h_.promise().finished; }
  std::coroutine_handle<> await_suspend(std::coroutine_handle<> c) noexcept {
    h_.promise().continuation = c;
    return h_;
  }
  void await_resume() {}
  // For root tasks driven by spawn().
  void start() {
    if (h_ && !h_.promise().finished) h_.resume();
  }
  bool done() const { return !h_ || h_.promise().finished; }

 private:
  Handle h_;
};

// co_await nextFrame(): resume on the next frame.
struct NextFrame {
  bool await_ready() const noexcept { return false; }
  void await_suspend(std::coroutine_handle<> h) noexcept { Scheduler::get().atNextFrame(h); }
  void await_resume() const noexcept {}
};
inline NextFrame nextFrame() { return {}; }

// Wait for a number of seconds of game time.
inline Task<> wait(float seconds) {
  float t = 0;
  while (t < seconds) {
    co_await nextFrame();
    t += Scheduler::get().dt();
  }
}

// Wait until a condition holds (checked once a frame).
inline Task<> until(std::function<bool()> cond) {
  while (!cond()) co_await nextFrame();
}

// Run two tasks side by side and wait for both.
inline Task<> both(Task<> a, Task<> b) {
  a.start();
  b.start();
  while (!a.done() || !b.done()) co_await nextFrame();
}

}  // namespace co
