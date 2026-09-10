// server/utils/shipping.js
// Motor de cálculo de envíos: local (Rionegro) vs nacional (Interrapidísimo / ENVÍA)

const LOCAL_CITY_KEYWORDS = ['rionegro', 'llanogrande', 'el retiro', 'la ceja', 'marinilla', 'guarne'];

function isLocal(city = '') {
  const c = city.trim().toLowerCase();
  return LOCAL_CITY_KEYWORDS.some(k => c.includes(k));
}

/**
 * Calcula el costo de envío nacional según peso total (gramos) y transportadora.
 * Tarifas base configurables — ajustar según tarifario real de cada transportadora.
 */
function nationalRate(totalWeightGrams, carrier) {
  const kg = Math.max(1, Math.ceil(totalWeightGrams / 1000));
  const rates = {
    interrapidisimo: { base: 12000, perExtraKg: 3500 },
    envia: { base: 13500, perExtraKg: 3200 }
  };
  const r = rates[carrier] || rates.interrapidisimo;
  const extraKg = Math.max(0, kg - 1);
  return r.base + extraKg * r.perExtraKg;
}

/**
 * @param {Object} params
 * @param {string} params.shippingType 'local_express' | 'local_pickup' | 'nacional'
 * @param {string} [params.carrier] 'interrapidisimo' | 'envia' (requerido si nacional)
 * @param {string} [params.city]
 * @param {number} params.totalWeightGrams
 * @param {number} params.totalQty
 */
function calculateShipping({ shippingType, carrier, city, totalWeightGrams, totalQty }) {
  if (shippingType === 'local_pickup') {
    return { cost: 0, label_es: 'Recogida en punto / entrega a mutuo acuerdo', label_en: 'Store pickup / meet-up delivery' };
  }
  if (shippingType === 'local_express') {
    if (!isLocal(city)) {
      throw new Error('El despacho express local solo aplica para Rionegro y municipios cercanos.');
    }
    // Tarifa plana local + recargo leve por volumen alto
    const cost = totalQty > 5 ? 12000 : 8000;
    return { cost, label_es: 'Despacho Express en Zona (Rionegro)', label_en: 'Local Express Delivery (Rionegro area)' };
  }
  if (shippingType === 'nacional') {
    if (!['interrapidisimo', 'envia'].includes(carrier)) {
      throw new Error('Selecciona una transportadora válida: Interrapidísimo o ENVÍA.');
    }
    const cost = nationalRate(totalWeightGrams, carrier);
    const carrierLabel = carrier === 'envia' ? 'ENVÍA' : 'Interrapidísimo';
    return { cost, label_es: `Envío nacional vía ${carrierLabel}`, label_en: `National shipping via ${carrierLabel}` };
  }
  throw new Error('Tipo de envío no reconocido.');
}

module.exports = { calculateShipping, isLocal };
