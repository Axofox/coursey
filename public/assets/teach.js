/* Instructor application form */
(function () {
  "use strict";
  var H = window.Coursehub;
  var form = document.querySelector("[data-apply-form]");
  if (!form) return;

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var errBox = form.querySelector("[data-apply-error]");
    errBox.classList.add("hide");
    var ok = H.validate(form, {
      name: H.rules.required("Your name"),
      email: H.rules.email,
      expertise: H.rules.required("What you'd teach"),
      bio: H.rules.minLength(20, "About you"),
      portfolio_url: H.rules.url,
    });
    if (!ok) return;
    var btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await H.api.submitApplication({
        name: form.name.value.trim(), email: form.email.value.trim(), expertise: form.expertise.value.trim(),
        bio: form.bio.value.trim(), portfolio_url: form.portfolio_url.value.trim(), website: form.website.value,
      });
      form.reset();
      form.querySelector("[data-apply-done]").classList.remove("hide");
      form.querySelector("[data-apply-done]").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hide");
    } finally {
      btn.disabled = false;
    }
  });
})();
