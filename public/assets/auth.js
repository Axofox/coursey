/* Sign in / sign up / forgot / reset forms */
(function () {
  "use strict";
  var H = window.Coursehub;
  var form = document.querySelector("[data-auth-form]");
  if (!form) return;
  var kind = form.getAttribute("data-auth-form");
  var done = form.querySelector("[data-auth-done]"), err = form.querySelector("[data-auth-error]");
  var next = H.getParam("next") || "";
  // only ever redirect within the site
  if (!/^[a-z0-9-]+\.html(\?[^#]*)?$/i.test(next)) next = "";

  function show(el, msg) { el.textContent = msg; el.classList.remove("hide"); }

  // Already signed in? Skip the form.
  if (kind === "login" || kind === "signup") {
    H.session.get().then(function (u) { if (u) location.replace(next || "dashboard.html"); });
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.classList.add("hide"); done.classList.add("hide");
    var rules = {
      login: { email: H.rules.email, password: H.rules.required("Password") },
      signup: { name: H.rules.required("Your name"), email: H.rules.email, password: function (v) {
        if (v.length < 10) return "Use at least 10 characters.";
        if (!/[a-zA-Z]/.test(v) || !/[0-9]/.test(v)) return "Mix letters and numbers.";
        return "";
      } },
      forgot: { email: H.rules.email },
      reset: { password: function (v) { return v.length < 10 ? "Use at least 10 characters." : (!/[a-zA-Z]/.test(v) || !/[0-9]/.test(v)) ? "Mix letters and numbers." : ""; },
               confirm: function (v, f) { return v === f.password.value ? "" : "Passwords don't match."; } },
    }[kind];
    if (!H.validate(form, rules)) return;
    var btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      if (kind === "login" || kind === "signup") {
        var data = { email: form.email.value.trim(), password: form.password.value };
        if (kind === "signup") data.name = form.name.value.trim();
        var user = await (kind === "login" ? H.api.login(data) : H.api.signup(data));
        H.session.set(user);
        location.href = next || "dashboard.html";
        return;
      }
      if (kind === "forgot") {
        await H.api.forgot(form.email.value.trim());
        show(done, "If that email has an account, a reset link is on its way. Check your inbox (and spam).");
        form.email.value = "";
      }
      if (kind === "reset") {
        await H.api.reset({ token: H.getParam("token") || "", password: form.password.value });
        show(done, "Password saved. You can sign in with it now.");
        setTimeout(function () { location.href = "login.html"; }, 1500);
      }
    } catch (ex) {
      show(err, ex.status === 429 ? "Too many attempts — please wait a few minutes." : ex.message);
    } finally {
      btn.disabled = false;
    }
  });
})();
