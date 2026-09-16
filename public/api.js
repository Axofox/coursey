/*
  Data layer — talks to the API in netlify/functions/api.mjs.

  Reads are public. Writes send the admin token, which the admin page keeps
  in sessionStorage for the current tab only (closing the tab forgets it).
*/

const API = "/api";
const TOKEN_KEY = "admin_token";

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
}
function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(API + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- Public reads ---------- */
const fetchCategories = () => request("GET", "/categories");
const fetchCategory = (id) => request("GET", "/categories/" + encodeURIComponent(id));

/* ---------- Admin writes ---------- */
const checkToken = () => request("GET", "/auth/check");
const createCategory = (data) => request("POST", "/categories", data);
const updateCategory = (id, data) => request("PUT", "/categories/" + encodeURIComponent(id), data);
const deleteCategory = (id) => request("DELETE", "/categories/" + encodeURIComponent(id));
const createCourse = (data) => request("POST", "/courses", data);
const updateCourse = (id, data) => request("PUT", "/courses/" + id, data);
const deleteCourse = (id) => request("DELETE", "/courses/" + id);
