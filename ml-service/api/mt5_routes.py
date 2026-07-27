import os
import MetaTrader5 as mt5
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Literal, Optional

router = APIRouter(prefix="/mt5", tags=["MT5 Broker Bridge"])

# Note: In a production environment, MT5 connection should be managed as a lifespan event
# For simplicity, we initialize on demand or check connection state.
def ensure_mt5_connection():
    if not mt5.initialize():
        raise HTTPException(status_code=500, detail=f"MT5 initialize failed, error code: {mt5.last_error()}")
        
    account = os.environ.get("MT5_ACCOUNT")
    password = os.environ.get("MT5_PASSWORD")
    server = os.environ.get("MT5_SERVER")

    if account and password and server:
        # Check if we are already logged in to the correct account
        acc_info = mt5.account_info()
        if acc_info is None or str(acc_info.login) != account:
            authorized = mt5.login(int(account), password=password, server=server)
            if not authorized:
                raise HTTPException(status_code=401, detail=f"MT5 login failed, error code: {mt5.last_error()}")

class OrderRequest(BaseModel):
    instrument: str
    action: Literal["BUY", "SELL"]
    volume: float = Field(..., gt=0)
    sl_pips: Optional[float] = None
    tp_pips: Optional[float] = None

class OrderResponse(BaseModel):
    order_id: str
    instrument: str
    action: str
    price: float
    volume: float

@router.post("/order", response_model=OrderResponse)
def place_order(req: OrderRequest):
    ensure_mt5_connection()
    
    symbol = req.instrument.replace("/", "").replace("_", "").replace("-", "")
    
    # Ensure symbol is available
    if not mt5.symbol_select(symbol, True):
        raise HTTPException(status_code=400, detail=f"Symbol {symbol} not found or failed to select")
        
    symbol_info = mt5.symbol_info(symbol)
    if symbol_info is None:
        raise HTTPException(status_code=400, detail=f"Failed to get symbol info for {symbol}")

    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise HTTPException(status_code=400, detail=f"Failed to get tick for {symbol}")

    order_type = mt5.ORDER_TYPE_BUY if req.action == "BUY" else mt5.ORDER_TYPE_SELL
    price = tick.ask if req.action == "BUY" else tick.bid
    
    sl = 0.0
    tp = 0.0
    point = symbol_info.point
    
    # Calculate SL / TP
    if req.sl_pips:
        sl_points = req.sl_pips * (100 if "JPY" in symbol else 10) * point
        sl = price - sl_points if req.action == "BUY" else price + sl_points
        
    if req.tp_pips:
        tp_points = req.tp_pips * (100 if "JPY" in symbol else 10) * point
        tp = price + tp_points if req.action == "BUY" else price - tp_points
        
    # Determine allowed filling mode dynamically
    possible_fillings = [mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN]
    if hasattr(symbol_info, "filling_mode"):
        possible_fillings = []
        if symbol_info.filling_mode & 1:
            possible_fillings.append(mt5.ORDER_FILLING_FOK)
        if symbol_info.filling_mode & 2:
            possible_fillings.append(mt5.ORDER_FILLING_IOC)
        possible_fillings.append(mt5.ORDER_FILLING_RETURN)

    last_result = None
    for filling_mode in possible_fillings:
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": req.volume,
            "type": order_type,
            "price": price,
            "sl": sl,
            "tp": tp,
            "deviation": 20,
            "magic": 234000,
            "comment": "Treadiiiio Bot Order",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling_mode,
        }
        
        result = mt5.order_send(request)
        last_result = result
        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            return OrderResponse(
                order_id=str(result.order),
                instrument=req.instrument,
                action=req.action,
                price=result.price,
                volume=result.volume
            )

    retcode = last_result.retcode if last_result else "UNKNOWN"
    comment = last_result.comment if last_result else "No result"
    
    if retcode == 10027:
        detail_msg = "AutoTrading is DISABLED in MetaTrader 5. Please click the 'Algo Trading' button (Ctrl+E) in MT5 top toolbar to turn it GREEN."
    else:
        detail_msg = f"Order failed, retcode={retcode} comment={comment}"
        
    raise HTTPException(status_code=400, detail=detail_msg)

class CloseOrderRequest(BaseModel):
    order_id: str
    volume: Optional[float] = None

@router.post("/close")
def close_order(req: CloseOrderRequest):
    ensure_mt5_connection()
    
    ticket = int(req.order_id)
    position = mt5.positions_get(ticket=ticket)
    
    if position is None or len(position) == 0:
        raise HTTPException(status_code=404, detail="Position not found")
        
    position = position[0]
    symbol = position.symbol
    symbol_info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    
    if tick is None or symbol_info is None:
        raise HTTPException(status_code=400, detail="Failed to get tick or symbol info for close")

    order_type = mt5.ORDER_TYPE_SELL if position.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
    price = tick.bid if order_type == mt5.ORDER_TYPE_SELL else tick.ask
    
    close_volume = req.volume if req.volume is not None and req.volume > 0 else position.volume

    possible_fillings = [mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN]
    if hasattr(symbol_info, "filling_mode"):
        possible_fillings = []
        if symbol_info.filling_mode & 1:
            possible_fillings.append(mt5.ORDER_FILLING_FOK)
        if symbol_info.filling_mode & 2:
            possible_fillings.append(mt5.ORDER_FILLING_IOC)
        possible_fillings.append(mt5.ORDER_FILLING_RETURN)

    last_result = None
    for filling_mode in possible_fillings:
        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": close_volume,
            "type": order_type,
            "position": ticket,
            "price": price,
            "deviation": 20,
            "magic": 234000,
            "comment": "Treadiiiio Bot Close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling_mode,
        }
        
        result = mt5.order_send(request)
        last_result = result
        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            return {"status": "closed", "order_id": req.order_id, "price": result.price}
        
    retcode = last_result.retcode if last_result else "UNKNOWN"
    raise HTTPException(status_code=400, detail=f"Close order failed, retcode={retcode}")

@router.get("/positions")
def get_positions():
    ensure_mt5_connection()
    
    positions = mt5.positions_get()
    if positions is None:
        return []
        
    result = []
    for pos in positions:
        result.append({
            "order_id": str(pos.ticket),
            "instrument": pos.symbol,
            "action": "BUY" if pos.type == mt5.ORDER_TYPE_BUY else "SELL",
            "volume": pos.volume,
            "price_open": pos.price_open,
            "price_current": pos.price_current,
            "sl": pos.sl,
            "tp": pos.tp,
            "profit": pos.profit,
            "time": pos.time
        })
        
    return result

@router.get("/quote")
def get_quote(instrument: str):
    ensure_mt5_connection()
    
    symbol = instrument.replace("/", "")
    if not mt5.symbol_select(symbol, True):
        raise HTTPException(status_code=400, detail=f"Symbol {symbol} not found")
        
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise HTTPException(status_code=400, detail="Failed to get tick data")
        
    return {
        "instrument": instrument,
        "bid": tick.bid,
        "ask": tick.ask,
        "time": tick.time
    }

@router.get("/account")
def get_account_info():
    ensure_mt5_connection()
    acc_info = mt5.account_info()
    if acc_info is None:
        raise HTTPException(status_code=500, detail="Failed to get MT5 account info")
    return {
        "login": acc_info.login,
        "balance": acc_info.balance,
        "equity": acc_info.equity,
        "profit": acc_info.profit,
        "margin": acc_info.margin,
        "margin_free": acc_info.margin_free,
        "leverage": acc_info.leverage,
        "currency": acc_info.currency,
        "server": acc_info.server,
        "company": acc_info.company
    }
