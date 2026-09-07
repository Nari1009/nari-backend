const formatOrderNumber = (value) => {
  const sequenceValue = Number(value);
  if (!Number.isSafeInteger(sequenceValue) || sequenceValue < 1) {
    throw new Error('Invalid public order number sequence value.');
  }
  return `NAR-${String(sequenceValue).padStart(6, '0')}`;
};

const nextOrderNumber = async (tx) => {
  const row = await tx.get("SELECT nextval('public.order_public_number_seq') AS value");
  return formatOrderNumber(row?.value);
};

module.exports = { formatOrderNumber, nextOrderNumber };
