import { auth, db, storage } from "./firebase.js";
import {
  onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup,
  signOut, sendEmailVerification, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
  deleteDoc, query, where, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";

const $ = id => document.getElementById(id);
const cash = n => "Rs. " + Number(n || 0).toLocaleString("en-PK");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const imageURL = s => /^https:\/\/\S+$/i.test(String(s || "")) ? esc(s) : "";

let user = null, profile = null, products = [], cart = [];
let settings = { deliveryFee:250, codFee:250, storeName:"ARVANO Store" };
let authMode = "login", busy = false;

try {
  cart = JSON.parse(localStorage.getItem("arvanoCart") || "[]");
  if (!Array.isArray(cart)) cart = [];
} catch { cart = []; }

function toast(message, error=false) {
  const n = $("notice");
  n.textContent = message;
  n.classList.toggle("error", error);
  n.classList.remove("hidden");
  clearTimeout(window.arvanoToastTimer);
  window.arvanoToastTimer = setTimeout(() => n.classList.add("hidden"), 4500);
}
function saveCart() {
  localStorage.setItem("arvanoCart", JSON.stringify(cart));
  $("cartCount").textContent = cart.reduce((n,i) => n + Number(i.qty || 0),0);
}
function isVerified() {
  return !!user && (user.emailVerified ||
    user.providerData.some(p => p.providerId === "google.com"));
}
function isAdmin() { return !!user && profile?.role === "admin"; }

window.showPage = async name => {
  const pages = ["home","shop","account","cart","checkout","orders","support","admin"];
  if (!pages.includes(name)) name = "home";
  if (["cart","checkout","orders","support"].includes(name) && !user) {
    toast("Please sign in first.");
    name = "account";
  }
  if (["checkout","orders","support"].includes(name) && user && !isVerified()) {
    toast("Please verify your email before using this feature.",true);
    name = "account";
  }
  if (name === "admin" && !isAdmin()) {
    toast("This account does not have admin access.",true);
    name = "account";
  }
  document.querySelectorAll("main .page").forEach(p => p.classList.add("hidden"));
  $(`${name}Page`).classList.remove("hidden");
  window.scrollTo({top:0,behavior:"smooth"});
  if (name === "shop") renderProducts();
  if (name === "cart") renderCart();
  if (name === "checkout") renderCheckout();
  if (name === "orders") await loadOrders();
  if (name === "support") await loadSupport();
  if (name === "admin") await loadAdmin();
};

window.setAuthMode = mode => {
  authMode = mode === "register" ? "register" : "login";
  $("loginTab").classList.toggle("active",authMode==="login");
  $("registerTab").classList.toggle("active",authMode==="register");
  $("nameLabel").classList.toggle("hidden",authMode!=="register");
  $("authName").required = authMode === "register";
  $("authSubmit").textContent = authMode === "register" ? "Create account" : "Sign in";
  $("authPassword").autocomplete = authMode === "register" ? "new-password" : "current-password";
};

$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (busy) return;
  busy = true; $("authSubmit").disabled = true;
  try {
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    if (authMode === "register") {
      const name = $("authName").value.trim();
      if (!name) throw new Error("Enter your name.");
      const cred = await createUserWithEmailAndPassword(auth,email,password);
      await updateProfile(cred.user,{displayName:name});
      await sendEmailVerification(cred.user);
      toast("Account created. Verify your email, then sign in.");
      await signOut(auth);
      window.setAuthMode("login");
    } else {
      const cred = await signInWithEmailAndPassword(auth,email,password);
      if (!cred.user.emailVerified) {
        await signOut(auth);
        throw new Error("Please verify your email using the link sent to your inbox.");
      }
      toast("Signed in successfully.");
      await window.showPage("home");
    }
  } catch(e) { console.error(e); toast(e.message || "Authentication failed.",true); }
  finally { busy = false; $("authSubmit").disabled = false; }
});

window.googleSignIn = async () => {
  try {
    await signInWithPopup(auth,new GoogleAuthProvider());
    toast("Google sign-in successful.");
    await window.showPage("home");
  } catch(e) { console.error(e); toast(e.message || "Google sign-in failed.",true); }
};
window.resetPassword = async () => {
  const email = $("authEmail").value.trim();
  if (!email) return toast("Enter your email first.",true);
  try { await sendPasswordResetEmail(auth,email); toast("Password reset email sent."); }
  catch(e) { toast(e.message,true); }
};
window.resendVerification = async () => {
  if (!auth.currentUser) return toast("Sign in first.",true);
  if (auth.currentUser.emailVerified) return toast("Email already verified.");
  try { await sendEmailVerification(auth.currentUser); toast("Verification email sent."); }
  catch(e) { toast(e.message,true); }
};
window.signOutUser = async () => {
  await signOut(auth);
  profile = null;
  toast("Signed out.");
  await window.showPage("home");
};

onAuthStateChanged(auth, async current => {
  user = current; profile = null;
  if (current) {
    try {
      const userRef = doc(db,"users",current.uid);
      let snap = await getDoc(userRef);
      if (!snap.exists()) {
        const newProfile = {
          uid:current.uid, name:current.displayName || "",
          email:current.email || "", role:"user", createdAt:serverTimestamp()
        };
        await setDoc(userRef,newProfile);
        snap = await getDoc(userRef);
      }
      profile = snap.data();
    } catch(e) {
      console.error("Profile error",e);
      toast("Could not load account profile. Check Firestore rules.",true);
    }
  }
  $("accountButton").textContent = current ? "My account" : "Sign in";
  $("signOutButton").classList.toggle("hidden",!current);
  $("adminButton").classList.toggle("hidden",profile?.role!=="admin");
  $("accountStatus").textContent = !current ? "Sign in or create an account." :
    !isVerified() ? "Email verification is required before checkout." :
    `Signed in as ${current.email || current.displayName || "customer"}`;
  await loadSettings();
  await refreshProducts();
  saveCart();
});

async function loadSettings() {
  try {
    const s = await getDoc(doc(db,"storeSettings","main"));
    if (s.exists()) settings = {...settings,...s.data()};
  } catch(e) { console.warn("Settings unavailable",e); }
}
async function refreshProducts() {
  try {
    const s = await getDocs(query(collection(db,"products"),where("published","==",true)));
    products = s.docs.map(d=>({id:d.id,...d.data()}));
    renderProducts(); renderFeatured(); fillCategories();
  } catch(e) {
    console.error(e);
    $("featuredProducts").innerHTML = '<div class="empty">Products unavailable. Check Firestore rules.</div>';
    $("allProducts").innerHTML = '<div class="empty">Products unavailable. Check Firestore rules.</div>';
  }
}
function fillCategories() {
  const select = $("categoryFilter"), old = select.value;
  const cats = [...new Set(products.map(p=>p.category).filter(Boolean))].sort();
  select.innerHTML = '<option value="">All categories</option>' +
    cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  select.value = cats.includes(old) ? old : "";
}
function productCard(p) {
  const img = imageURL(p.imageUrl);
  return `<article class="product">
    ${img ? `<img loading="lazy" src="${img}" alt="${esc(p.name)}" onerror="this.style.display='none'">` : '<div class="image-fallback">A.</div>'}
    <div class="product-info"><span class="category">${esc(p.category||"Collection")}</span>
    <h3>${esc(p.name)}</h3><p class="description">${esc(p.description||"Discover this selected product.")}</p>
    <div class="product-bottom"><span class="price">${cash(p.price)}</span>
    <button class="add" onclick="addToCart('${p.id}')" ${Number(p.stock||0)<1?"disabled":""}>${Number(p.stock||0)>0?"Add +":"Out of stock"}</button></div></div></article>`;
}
function renderFeatured() {
  $("featuredProducts").innerHTML = products.length ? products.slice(0,4).map(productCard).join("") :
    '<div class="empty">Products will appear here when the store admin publishes them.</div>';
}
window.renderProducts = () => {
  const q = ($("searchInput").value||"").trim().toLowerCase();
  const c = $("categoryFilter").value, sort = $("sortFilter").value;
  let list = products.filter(p=>(!c||p.category===c)&&
    (!q||`${p.name||""} ${p.description||""} ${p.category||""}`.toLowerCase().includes(q)));
  if(sort==="low") list.sort((a,b)=>Number(a.price)-Number(b.price));
  if(sort==="high") list.sort((a,b)=>Number(b.price)-Number(a.price));
  if(sort==="name") list.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  $("allProducts").innerHTML = list.length ? list.map(productCard).join("") :
    '<div class="empty">No products found.</div>';
};

window.addToCart = id => {
  if (!user) { toast("Sign in before adding products."); return window.showPage("account"); }
  const p = products.find(x=>x.id===id);
  if (!p || Number(p.stock||0)<1) return toast("Product is unavailable.",true);
  const item = cart.find(x=>x.id===id);
  if (item) {
    if (item.qty >= Number(p.stock)) return toast("No more stock available.",true);
    item.qty++;
  } else cart.push({id,qty:1});
  saveCart(); toast("Added to cart.");
};
window.changeQty = (id,value) => {
  const p=products.find(x=>x.id===id), n=Math.floor(Number(value));
  const item=cart.find(x=>x.id===id);
  if(!item)return;
  if(!Number.isFinite(n)||n<1)cart=cart.filter(x=>x.id!==id);
  else item.qty=Math.min(n,Number(p?.stock||1));
  saveCart();renderCart();
};
window.removeFromCart = id => {cart=cart.filter(x=>x.id!==id);saveCart();renderCart();};
function cartItems() {
  return cart.map(i=>{const p=products.find(x=>x.id===i.id);return p?{...p,qty:Math.min(Number(i.qty)||1,Number(p.stock)||1)}:null;}).filter(Boolean);
}
function renderCart() {
  const items=cartItems();
  if(!items.length){$("cartContent").innerHTML='<div class="empty"><h3>Your cart is empty</h3><button class="primary" onclick="showPage(\'shop\')">Browse products</button></div>';return;}
  const sub=items.reduce((n,i)=>n+Number(i.price)*i.qty,0);
  $("cartContent").innerHTML=`<div class="columns"><div class="panel">${items.map(i=>`<div class="cart-row">
    ${imageURL(i.imageUrl)?`<img src="${imageURL(i.imageUrl)}" alt="">`:'<div class="image-fallback">A.</div>'}
    <div><strong>${esc(i.name)}</strong><p class="muted">${cash(i.price)} each</p>
    <label>Qty<input type="number" min="1" max="${Number(i.stock)}" value="${i.qty}" onchange="changeQty('${i.id}',this.value)"></label></div>
    <div><strong>${cash(Number(i.price)*i.qty)}</strong><button class="link" onclick="removeFromCart('${i.id}')">Remove</button></div>
    </div>`).join("")}</div><aside class="panel"><h3>Summary</h3><div class="summary-line"><span>Subtotal</span><strong>${cash(sub)}</strong></div>
    <p class="muted small">Delivery and COD fees are calculated at checkout.</p>
    <button class="primary full" onclick="showPage('checkout')">Continue to checkout</button></aside></div>`;
}
function renderCheckout() {
  if(!cartItems().length){toast("Your cart is empty.");return window.showPage("cart");}
  if(!user||!isVerified()){toast("Sign in and verify your email first.",true);return window.showPage("account");}
  const items=cartItems(), sub=items.reduce((n,i)=>n+Number(i.price)*i.qty,0);
  $("checkoutContent").innerHTML=`<div class="checkout-layout"><form class="panel" id="checkoutForm">
    <h3>Delivery details</h3>
    <label>Full name<input id="deliveryName" required maxlength="100" value="${esc(user.displayName||profile?.name||"")}"></label>
    <label>Phone number<input id="deliveryPhone" required maxlength="25" placeholder="03xx xxxxxxx"></label>
    <label>City<input id="deliveryCity" required maxlength="100"></label>
    <label>Full address<textarea id="deliveryAddress" required maxlength="500" rows="3"></textarea></label>
    <h3>Payment method</h3><label>Choose payment<select id="paymentMethod" onchange="updateCheckoutSummary()">
      <option value="COD">Cash on Delivery</option><option value="Easypaisa">Easypaisa</option>
      <option value="JazzCash">JazzCash</option><option value="Bank Transfer">Bank transfer</option>
    </select></label>
    <div id="paymentInstructions" class="support-reply">Pay when your order is delivered.</div>
    <label>Transaction reference (prepaid only)<input id="paymentReference" maxlength="120"></label>
    <button class="primary full" id="placeOrderButton">Place order</button>
    <p class="muted small">Prepaid orders require store admin verification. Confirm official merchant details before transferring money.</p>
  </form><aside class="panel"><h3>Order summary</h3>
    ${items.map(i=>`<div class="summary-line"><span>${esc(i.name)} × ${i.qty}</span><strong>${cash(i.price*i.qty)}</strong></div>`).join("")}
    <div class="summary-line"><span>Subtotal</span><strong>${cash(sub)}</strong></div>
    <div class="summary-line"><span>Delivery</span><strong>${cash(settings.deliveryFee)}</strong></div>
    <div class="summary-line"><span>COD fee</span><strong id="codFee">${cash(settings.codFee)}</strong></div>
    <div class="summary-line total"><span>Total</span><strong id="checkoutTotal">${cash(sub+Number(settings.deliveryFee)+Number(settings.codFee))}</strong></div>
  </aside></div>`;
  $("checkoutForm").addEventListener("submit",placeOrder);
  window.updateCheckoutSummary();
}
window.updateCheckoutSummary = () => {
  const method=$("paymentMethod").value, sub=cartItems().reduce((n,i)=>n+Number(i.price)*i.qty,0);
  const cod=method==="COD"?Number(settings.codFee||0):0;
  $("codFee").textContent=cash(cod);
  $("checkoutTotal").textContent=cash(sub+Number(settings.deliveryFee||0)+cod);
  $("paymentInstructions").textContent=method==="COD"?"Pay when your order is delivered.":"Manual payment verification required. Ask the store for confirmed official merchant details before sending money.";
};
async function placeOrder(e) {
  e.preventDefault();
  if(!user||!isVerified())return toast("Sign in and verify your email first.",true);
  const btn=$("placeOrderButton");btn.disabled=true;
  try{
    const items=cartItems();if(!items.length)throw new Error("Your cart is empty.");
    const method=$("paymentMethod").value, sub=items.reduce((n,i)=>n+Number(i.price)*i.qty,0);
    const delivery=Number(settings.deliveryFee||0),cod=method==="COD"?Number(settings.codFee||0):0;
    await addDoc(collection(db,"orders"),{
      userId:user.uid,customerEmail:user.email||"",customerName:$("deliveryName").value.trim(),
      phone:$("deliveryPhone").value.trim(),city:$("deliveryCity").value.trim(),
      address:$("deliveryAddress").value.trim(),
      items:items.map(i=>({productId:i.id,name:String(i.name),price:Number(i.price),quantity:i.qty,imageUrl:imageURL(i.imageUrl)})),
      subtotal:sub,deliveryFee:delivery,codFee:cod,total:sub+delivery+cod,
      paymentMethod:method,paymentReference:$("paymentReference").value.trim(),
      paymentStatus:method==="COD"?"cod_due":"pending_verification",
      status:"Pending",createdAt:serverTimestamp()
    });
    cart=[];saveCart();toast("Order placed. Track it under My orders.");await window.showPage("orders");
  }catch(e){console.error(e);toast(e.message||"Order could not be placed.",true);}
  finally{btn.disabled=false;}
}
async function loadOrders() {
  $("ordersContent").innerHTML='<div class="empty">Loading orders...</div>';
  try{
    const s=await getDocs(query(collection(db,"orders"),where("userId","==",user.uid),limit(50)));
    const rows=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    $("ordersContent").innerHTML=rows.length?rows.map(o=>`<article class="order-card">
      <div class="order-head"><strong>Order #${esc(o.id.slice(-8).toUpperCase())}</strong><span class="pill">${esc(o.status)}</span></div>
      <p class="muted">${(o.items||[]).map(i=>`${esc(i.name)} × ${Number(i.quantity)}`).join(" · ")}</p>
      <div class="summary-line"><span>Total</span><strong>${cash(o.total)}</strong></div>
      <p class="muted small">Payment: ${esc(o.paymentMethod)} · ${esc(o.paymentStatus)}</p></article>`).join(""):'<div class="empty">You have no orders yet.</div>';
  }catch(e){console.error(e);$("ordersContent").innerHTML='<div class="empty">Orders unavailable. Check Firestore rules.</div>';}
}
$("supportForm").addEventListener("submit",async e=>{
  e.preventDefault();if(!user||!isVerified())return toast("Sign in and verify your email first.",true);
  const b=$("supportForm").querySelector("button");b.disabled=true;
  try{
    await addDoc(collection(db,"supportTickets"),{
      userId:user.uid,email:user.email||"",subject:$("supportSubject").value.trim(),
      message:$("supportMessage").value.trim(),reply:"",status:"open",createdAt:serverTimestamp()
    });
    $("supportForm").reset();toast("Support message sent.");await loadSupport();
  }catch(e){toast(e.message,true);}finally{b.disabled=false;}
});
async function loadSupport() {
  try{
    const s=await getDocs(query(collection(db,"supportTickets"),where("userId","==",user.uid),limit(50)));
    const rows=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    $("supportList").innerHTML=rows.length?rows.map(t=>`<article class="ticket"><strong>${esc(t.subject)}</strong><p>${esc(t.message)}</p><span class="pill">${esc(t.status)}</span>${t.reply?`<div class="support-reply"><b>Store reply</b><p>${esc(t.reply)}</p></div>`:'<p class="muted small">Waiting for reply.</p>'}</article>`).join(""):'<div class="empty">No support messages yet.</div>';
  }catch(e){toast(e.message,true);}
}

/* ---------------- ADMIN PANEL ---------------- */
let aProducts=[],aOrders=[],aTickets=[],aSettings={},aTab="products";
window.adminTab=async tab=>{
  if(!isAdmin())return toast("Admin access required.",true);
  aTab=tab;
  await loadAdminData();
  renderAdminTab();
};
async function loadAdminData(){
  const [p,o,t,s]=await Promise.all([
    getDocs(collection(db,"products")),getDocs(query(collection(db,"orders"),limit(200))),
    getDocs(query(collection(db,"supportTickets"),limit(200))),getDoc(doc(db,"storeSettings","main"))
  ]);
  aProducts=p.docs.map(d=>({id:d.id,...d.data()}));
  aOrders=o.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  aTickets=t.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  aSettings=s.exists()?s.data():{deliveryFee:250,codFee:250,storeName:"ARVANO Store"};
}
async function loadAdmin(){
  if(!isAdmin())return toast("Admin access required.",true);
  $("adminContent").innerHTML='<div class="empty">Loading admin data...</div>';
  try{await loadAdminData();renderAdminStats();renderAdminTab();}
  catch(e){console.error(e);$("adminContent").innerHTML='<div class="empty">Could not load admin data. Confirm your admin role and rules.</div>';toast(e.message,true);}
}
function renderAdminStats(){
  const revenue=aOrders.filter(o=>["verified","cod_paid"].includes(o.paymentStatus)).reduce((n,o)=>n+Number(o.total||0),0);
  $("adminStats").innerHTML=`<div class="stat"><span>Total orders</span><strong>${aOrders.length}</strong></div>
    <div class="stat"><span>Confirmed payments</span><strong>${cash(revenue)}</strong></div>
    <div class="stat"><span>Products</span><strong>${aProducts.length}</strong></div>
    <div class="stat"><span>Open support</span><strong>${aTickets.filter(t=>t.status!=="closed").length}</strong></div>`;
}
function renderAdminTab(){
  if(!isAdmin())return;
  if(aTab==="products")renderAdminProducts();
  if(aTab==="orders")renderAdminOrders();
  if(aTab==="support")renderAdminSupport();
  if(aTab==="settings")renderAdminSettings();
}
function renderAdminProducts(){
  $("adminContent").innerHTML=`<div class="panel"><h3 id="productFormHeading">Add product</h3>
    <form id="productForm"><input type="hidden" id="editId"><div class="form-grid">
    <label>Name<input id="pName" required maxlength="150"></label>
    <label>Category<input id="pCategory" required maxlength="80"></label>
    <label>Price (PKR)<input id="pPrice" required type="number" min="0"></label>
    <label>Cost price (PKR)<input id="pCost" type="number" min="0" value="0"></label>
    <label>Stock<input id="pStock" required type="number" min="0" step="1" value="0"></label>
    <label>Image URL<input id="pImage" type="url" placeholder="https://..."></label>
    <label class="wide">Description<textarea id="pDescription" rows="3" maxlength="2000"></textarea></label>
    <label class="wide">Upload image<input id="pFile" type="file" accept="image/jpeg,image/png,image/webp"></label>
    <label class="wide"><input id="pPublished" type="checkbox" checked style="width:auto"> Publish product</label>
    </div><button class="primary">Save product</button><button type="button" class="secondary" onclick="clearProductForm()">Clear</button></form></div>
    <h3>Inventory (${aProducts.length})</h3><div class="table-wrap"><table><thead><tr><th>Product</th><th>Price</th><th>Cost</th><th>Stock</th><th>Published</th><th>Actions</th></tr></thead><tbody>
    ${aProducts.map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.category)}</small></td><td>${cash(p.price)}</td><td>${cash(p.costPrice)}</td><td>${Number(p.stock||0)}</td><td>${p.published?"Yes":"No"}</td><td><button class="secondary" onclick="editProduct('${p.id}')">Edit</button><button class="danger" onclick="deleteProduct('${p.id}')">Delete</button></td></tr>`).join("")}
    </tbody></table></div>`;
  $("productForm").addEventListener("submit",saveProduct);
}
window.clearProductForm=()=>{$("productForm").reset();$("editId").value="";$("productFormHeading").textContent="Add product";};
window.editProduct=id=>{
  const p=aProducts.find(x=>x.id===id);if(!p||!isAdmin())return;
  $("editId").value=id;$("pName").value=p.name||"";$("pCategory").value=p.category||"";
  $("pPrice").value=p.price??0;$("pCost").value=p.costPrice??0;$("pStock").value=p.stock??0;
  $("pImage").value=p.imageUrl||"";$("pDescription").value=p.description||"";
  $("pPublished").checked=!!p.published;$("productFormHeading").textContent="Edit product";
  $("productForm").scrollIntoView({behavior:"smooth"});
};
async function saveProduct(e){
  e.preventDefault();if(!isAdmin())return toast("Admin access required.",true);
  const b=$("productForm").querySelector('button.primary');b.disabled=true;
  try{
    const name=$("pName").value.trim(),category=$("pCategory").value.trim();
    const price=Number($("pPrice").value),costPrice=Number($("pCost").value||0),stock=Number($("pStock").value);
    if(!name||!category||!Number.isFinite(price)||price<0||!Number.isFinite(costPrice)||costPrice<0||!Number.isInteger(stock)||stock<0)throw new Error("Check product fields and values.");
    let imageUrl=$("pImage").value.trim();const file=$("pFile").files?.[0];
    if(file){
      if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Image must be JPG, PNG or WebP.");
      if(file.size>5*1024*1024)throw new Error("Image must be 5 MB or smaller.");
      const storageRef=ref(storage,`products/${auth.currentUser.uid}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`);
      await uploadBytes(storageRef,file,{contentType:file.type});imageUrl=await getDownloadURL(storageRef);
    }
    if(imageUrl&&!/^https:\/\/\S+$/i.test(imageUrl))throw new Error("Image URL must start with HTTPS.");
    const id=$("editId").value;
    const data={name,category,price,costPrice,stock,imageUrl,description:$("pDescription").value.trim(),published:$("pPublished").checked,updatedAt:serverTimestamp()};
    if(id)await updateDoc(doc(db,"products",id),data);
    else await addDoc(collection(db,"products"),{...data,createdAt:serverTimestamp()});
    toast(id?"Product updated.":"Product added.");await loadAdminData();renderAdminStats();renderAdminProducts();await refreshProducts();
  }catch(e){console.error(e);toast(e.message||"Product could not be saved.",true);}
  finally{b.disabled=false;}
}
window.deleteProduct=async id=>{
  if(!isAdmin()||!confirm("Delete this product? Past order records remain."))return;
  try{await deleteDoc(doc(db,"products",id));toast("Product deleted.");await loadAdminData();renderAdminStats();renderAdminProducts();await refreshProducts();}
  catch(e){toast(e.message,true);}
};
function renderAdminOrders(){
  const statuses=["Pending","Confirmed","Processing","Shipped","Delivered","Cancelled"];
  const payments=["pending_verification","verified","cod_due","cod_paid","rejected"];
  $("adminContent").innerHTML=`<h3>Orders (${aOrders.length})</h3><div class="table-wrap"><table><thead><tr><th>Customer / order</th><th>Items / address</th><th>Total</th><th>Payment status</th><th>Order status</th><th>Save</th></tr></thead><tbody>
  ${aOrders.map(o=>`<tr><td><b>#${esc(o.id.slice(-8))}</b><br>${esc(o.customerName)}<br>${esc(o.customerEmail)}<br>${esc(o.phone)} · ${esc(o.city)}</td>
  <td>${(o.items||[]).map(i=>`${esc(i.name)} × ${Number(i.quantity)}`).join("<br>")}<br><small>${esc(o.address)}</small></td>
  <td>${cash(o.total)}</td><td>${esc(o.paymentMethod)}<br><small>Ref: ${esc(o.paymentReference||"None")}</small><select id="pay-${o.id}">${payments.map(p=>`<option value="${p}" ${o.paymentStatus===p?"selected":""}>${p}</option>`).join("")}</select></td>
  <td><select id="status-${o.id}">${statuses.map(s=>`<option value="${s}" ${o.status===s?"selected":""}>${s}</option>`).join("")}</select></td>
  <td><button class="primary" onclick="saveOrder('${o.id}')">Save</button></td></tr>`).join("")}</tbody></table></div>`;
}
window.saveOrder=async id=>{
  if(!isAdmin())return toast("Admin access required.",true);
  try{
    await updateDoc(doc(db,"orders",id),{status:$(`status-${id}`).value,paymentStatus:$(`pay-${id}`).value,updatedAt:serverTimestamp()});
    toast("Order updated.");await loadAdminData();renderAdminStats();renderAdminOrders();
  }catch(e){toast(e.message,true);}
};
function renderAdminSupport(){
  $("adminContent").innerHTML=`<h3>Support inbox (${aTickets.length})</h3>${aTickets.length?aTickets.map(t=>`<article class="ticket">
  <b>${esc(t.subject)}</b><p class="muted small">${esc(t.email)} · ${esc(t.id.slice(-8))}</p><p>${esc(t.message)}</p>
  <label>Reply<textarea id="reply-${t.id}" rows="3" maxlength="3000">${esc(t.reply||"")}</textarea></label>
  <label>Status<select id="ticketStatus-${t.id}"><option value="open" ${t.status==="open"?"selected":""}>Open</option><option value="answered" ${t.status==="answered"?"selected":""}>Answered</option><option value="closed" ${t.status==="closed"?"selected":""}>Closed</option></select></label>
  <button class="primary" onclick="saveTicket('${t.id}')">Save reply</button></article>`).join(""):'<div class="empty">No support messages.</div>'}`;
}
window.saveTicket=async id=>{
  if(!isAdmin())return toast("Admin access required.",true);
  try{await updateDoc(doc(db,"supportTickets",id),{reply:$(`reply-${id}`).value.trim(),status:$(`ticketStatus-${id}`).value,updatedAt:serverTimestamp()});toast("Support reply saved.");await loadAdminData();renderAdminStats();renderAdminSupport();}
  catch(e){toast(e.message,true);}
};
function renderAdminSettings(){
  $("adminContent").innerHTML=`<div class="panel"><h3>Store settings</h3><form id="settingsForm">
  <label>Store name<input id="sName" maxlength="100" required value="${esc(aSettings.storeName||"ARVANO Store")}"></label>
  <label>Delivery fee (PKR)<input id="sDelivery" type="number" min="0" required value="${Number(aSettings.deliveryFee||0)}"></label>
  <label>COD fee (PKR)<input id="sCod" type="number" min="0" required value="${Number(aSettings.codFee||0)}"></label>
  <button class="primary">Save settings</button></form>
  <p class="muted small">Only enter verified official merchant details in a future payment setup. Automatic payment verification is not enabled.</p></div>`;
  $("settingsForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!isAdmin())return toast("Admin access required.",true);
    const deliveryFee=Number($("sDelivery").value),codFee=Number($("sCod").value);
    if(deliveryFee<0||codFee<0||!Number.isFinite(deliveryFee)||!Number.isFinite(codFee))return toast("Enter valid fees.",true);
    try{aSettings={storeName:$("sName").value.trim(),deliveryFee,codFee,currency:"PKR"};
      await setDoc(doc(db,"storeSettings","main"),{...aSettings,updatedAt:serverTimestamp()},{merge:true});
      settings={...settings,...aSettings};toast("Store settings saved.");
    }catch(e){toast(e.message,true);}
  });
}

$("year").textContent=new Date().getFullYear();
saveCart();
